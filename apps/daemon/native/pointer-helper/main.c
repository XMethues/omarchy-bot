#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <wayland-client.h>

#include "wlr-virtual-pointer-unstable-v1-client-protocol.h"

#define BTN_LEFT 272u
#define BTN_RIGHT 273u
#define BTN_MIDDLE 274u
#define COORDINATE_SCALE 1000.0
#define SCROLL_SCALE 12.0

struct output_binding {
  struct wl_output *output;
  struct output_binding *next;
  const char *target_name;
  bool matched;
};

struct registry_state {
  struct wl_display *display;
  struct zwlr_virtual_pointer_manager_v1 *manager;
  struct output_binding *outputs;
  struct wl_output *target_output;
  const char *target_name;
};

struct pointer_state {
  struct wl_display *display;
  struct zwlr_virtual_pointer_v1 *pointer;
  bool held_left;
  bool held_middle;
  bool held_right;
};

static uint32_t monotonic_milliseconds(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return 0;
  return (uint32_t)((uint64_t)now.tv_sec * 1000u + (uint64_t)now.tv_nsec / 1000000u);
}

static void output_geometry(void *data, struct wl_output *output, int32_t x,
                            int32_t y, int32_t physical_width,
                            int32_t physical_height, int32_t subpixel,
                            const char *make, const char *model,
                            int32_t transform) {
  (void)data; (void)output; (void)x; (void)y; (void)physical_width;
  (void)physical_height; (void)subpixel; (void)make; (void)model;
  (void)transform;
}

static void output_mode(void *data, struct wl_output *output, uint32_t flags,
                        int32_t width, int32_t height, int32_t refresh) {
  (void)data; (void)output; (void)flags; (void)width; (void)height;
  (void)refresh;
}

static void output_done(void *data, struct wl_output *output) {
  (void)data; (void)output;
}

static void output_scale(void *data, struct wl_output *output, int32_t factor) {
  (void)data; (void)output; (void)factor;
}

static void output_name(void *data, struct wl_output *output, const char *name) {
  struct output_binding *binding = data;
  if (strcmp(name, binding->target_name) == 0) binding->matched = true;
  (void)output;
}

static void output_description(void *data, struct wl_output *output,
                               const char *description) {
  (void)data; (void)output; (void)description;
}

static const struct wl_output_listener output_listener = {
  .geometry = output_geometry,
  .mode = output_mode,
  .done = output_done,
  .scale = output_scale,
  .name = output_name,
  .description = output_description,
};

static void registry_global(void *data, struct wl_registry *registry,
                            uint32_t name, const char *interface,
                            uint32_t version) {
  struct registry_state *state = data;
  if (strcmp(interface, zwlr_virtual_pointer_manager_v1_interface.name) == 0) {
    uint32_t bind_version = version < 2 ? version : 2;
    state->manager = wl_registry_bind(
        registry, name, &zwlr_virtual_pointer_manager_v1_interface,
        bind_version);
    return;
  }
  if (strcmp(interface, wl_output_interface.name) != 0 || version < 4) return;
  struct output_binding *binding = calloc(1, sizeof(*binding));
  if (binding == NULL) return;
  binding->target_name = state->target_name;
  binding->output = wl_registry_bind(registry, name, &wl_output_interface, 4);
  binding->next = state->outputs;
  state->outputs = binding;
  wl_output_add_listener(binding->output, &output_listener, binding);
}

static void registry_global_remove(void *data, struct wl_registry *registry,
                                   uint32_t name) {
  (void)data; (void)registry; (void)name;
}

static const struct wl_registry_listener registry_listener = {
  .global = registry_global,
  .global_remove = registry_global_remove,
};

static bool parse_sequence(const char *line, unsigned long long *sequence) {
  const char *space = strchr(line, ' ');
  if (space == NULL) return false;
  errno = 0;
  char *end = NULL;
  unsigned long long parsed = strtoull(space + 1, &end, 10);
  if (errno != 0 || end == space + 1 || (*end != ' ' && *end != '\n' && *end != '\0')) return false;
  *sequence = parsed;
  return true;
}

static bool supported_button(unsigned int button) {
  return button == BTN_LEFT || button == BTN_MIDDLE || button == BTN_RIGHT;
}

static bool *held_button(struct pointer_state *state, unsigned int button) {
  if (button == BTN_LEFT) return &state->held_left;
  if (button == BTN_MIDDLE) return &state->held_middle;
  if (button == BTN_RIGHT) return &state->held_right;
  return NULL;
}

static void release_held(struct pointer_state *state) {
  uint32_t now = monotonic_milliseconds();
  if (state->held_left) zwlr_virtual_pointer_v1_button(state->pointer, now, BTN_LEFT, WL_POINTER_BUTTON_STATE_RELEASED);
  if (state->held_middle) zwlr_virtual_pointer_v1_button(state->pointer, now, BTN_MIDDLE, WL_POINTER_BUTTON_STATE_RELEASED);
  if (state->held_right) zwlr_virtual_pointer_v1_button(state->pointer, now, BTN_RIGHT, WL_POINTER_BUTTON_STATE_RELEASED);
  if (state->held_left || state->held_middle || state->held_right) zwlr_virtual_pointer_v1_frame(state->pointer);
  state->held_left = false;
  state->held_middle = false;
  state->held_right = false;
}

static int fixture_loop(void) {
  char line[512];
  puts("READY fixture");
  fflush(stdout);
  while (fgets(line, sizeof(line), stdin) != NULL) {
    unsigned long long sequence = 0;
    if (!parse_sequence(line, &sequence)) {
      puts("ERR malformed");
      fflush(stdout);
      continue;
    }
    const char *kind = strncmp(line, "motion ", 7) == 0 ? "motion"
        : strncmp(line, "button ", 7) == 0 ? "button"
        : strncmp(line, "scroll ", 7) == 0 ? "scroll"
        : strncmp(line, "release ", 8) == 0 ? "release" : NULL;
    if (kind == NULL) printf("ERR %llu unknown\n", sequence);
    else printf("OK %llu %s\n", sequence, kind);
    fflush(stdout);
  }
  return 0;
}

static int command_loop(struct pointer_state *state) {
  char line[512];
  unsigned long long last_sequence = 0;
  printf("READY\n");
  fflush(stdout);
  while (fgets(line, sizeof(line), stdin) != NULL) {
    unsigned long long sequence = 0;
    if (!parse_sequence(line, &sequence) || sequence <= last_sequence) {
      fprintf(stderr, "invalid helper sequence\n");
      return 2;
    }
    uint32_t now = monotonic_milliseconds();
    if (strncmp(line, "motion ", 7) == 0) {
      double x = 0, y = 0;
      unsigned int width = 0, height = 0;
      if (sscanf(line, "motion %llu %lf %lf %u %u", &sequence, &x, &y, &width, &height) != 5
          || !isfinite(x) || !isfinite(y) || width == 0 || height == 0
          || x < 0 || y < 0 || x >= width || y >= height) return 2;
      zwlr_virtual_pointer_v1_motion_absolute(
          state->pointer, now, (uint32_t)llround(x * COORDINATE_SCALE),
          (uint32_t)llround(y * COORDINATE_SCALE),
          (uint32_t)llround(width * COORDINATE_SCALE),
          (uint32_t)llround(height * COORDINATE_SCALE));
      zwlr_virtual_pointer_v1_frame(state->pointer);
    } else if (strncmp(line, "button ", 7) == 0) {
      unsigned int button = 0, pressed = 0;
      if (sscanf(line, "button %llu %u %u", &sequence, &button, &pressed) != 3
          || !supported_button(button) || pressed > 1) return 2;
      bool *held = held_button(state, button);
      zwlr_virtual_pointer_v1_button(state->pointer, now, button,
          pressed ? WL_POINTER_BUTTON_STATE_PRESSED : WL_POINTER_BUTTON_STATE_RELEASED);
      zwlr_virtual_pointer_v1_frame(state->pointer);
      *held = pressed != 0;
    } else if (strncmp(line, "scroll ", 7) == 0) {
      double delta_x = 0, delta_y = 0;
      if (sscanf(line, "scroll %llu %lf %lf", &sequence, &delta_x, &delta_y) != 3
          || !isfinite(delta_x) || !isfinite(delta_y)
          || (delta_x == 0 && delta_y == 0)) return 2;
      zwlr_virtual_pointer_v1_axis_source(state->pointer, WL_POINTER_AXIS_SOURCE_WHEEL);
      if (delta_x != 0) zwlr_virtual_pointer_v1_axis(
          state->pointer, now, WL_POINTER_AXIS_HORIZONTAL_SCROLL,
          wl_fixed_from_double(delta_x / SCROLL_SCALE));
      if (delta_y != 0) zwlr_virtual_pointer_v1_axis(
          state->pointer, now, WL_POINTER_AXIS_VERTICAL_SCROLL,
          wl_fixed_from_double(delta_y / SCROLL_SCALE));
      zwlr_virtual_pointer_v1_frame(state->pointer);
    } else if (strncmp(line, "release ", 8) == 0) {
      release_held(state);
    } else {
      return 2;
    }
    if (wl_display_roundtrip(state->display) < 0) return 3;
    last_sequence = sequence;
    printf("OK %llu\n", sequence);
    fflush(stdout);
  }
  release_held(state);
  wl_display_roundtrip(state->display);
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--fixture") == 0) return fixture_loop();
  if (argc != 2 || argv[1][0] == '\0') {
    fprintf(stderr, "usage: %s OUTPUT_NAME\n", argv[0]);
    return 2;
  }
  struct registry_state registry_state = { .target_name = argv[1] };
  registry_state.display = wl_display_connect(NULL);
  if (registry_state.display == NULL) {
    fprintf(stderr, "cannot connect to assigned Wayland socket\n");
    return 3;
  }
  struct wl_registry *registry = wl_display_get_registry(registry_state.display);
  wl_registry_add_listener(registry, &registry_listener, &registry_state);
  if (wl_display_roundtrip(registry_state.display) < 0
      || wl_display_roundtrip(registry_state.display) < 0) return 3;
  for (struct output_binding *binding = registry_state.outputs; binding != NULL; binding = binding->next) {
    if (binding->matched) {
      registry_state.target_output = binding->output;
      break;
    }
  }
  if (registry_state.manager == NULL || registry_state.target_output == NULL
      || zwlr_virtual_pointer_manager_v1_get_version(registry_state.manager) < 2) {
    fprintf(stderr, "assigned output or wlr virtual pointer v2 is unavailable\n");
    return 4;
  }
  struct pointer_state pointer_state = {
    .display = registry_state.display,
    .pointer = zwlr_virtual_pointer_manager_v1_create_virtual_pointer_with_output(
        registry_state.manager, NULL, registry_state.target_output),
  };
  if (wl_display_roundtrip(registry_state.display) < 0) return 3;
  int result = command_loop(&pointer_state);
  zwlr_virtual_pointer_v1_destroy(pointer_state.pointer);
  zwlr_virtual_pointer_manager_v1_destroy(registry_state.manager);
  wl_registry_destroy(registry);
  wl_display_disconnect(registry_state.display);
  return result;
}
