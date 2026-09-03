#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <wayland-client.h>
#include <xkbcommon/xkbcommon.h>

#include "virtual-keyboard-unstable-v1-client-protocol.h"
#include "wlr-virtual-pointer-unstable-v1-client-protocol.h"

#define BTN_LEFT 272u
#define BTN_RIGHT 273u
#define BTN_MIDDLE 274u
#define KEY_LEFTSHIFT 42u
#define KEY_F24 194u
#define MAX_KEY_CODE 255u
#define COORDINATE_SCALE 1000.0
#define SCROLL_SCALE 12.0
#define MAX_PASTE_BYTES 65536u

struct output_binding {
  struct wl_output *output;
  struct output_binding *next;
  const char *target_name;
  bool matched;
};

struct registry_state {
  struct wl_display *display;
  struct zwlr_virtual_pointer_manager_v1 *pointer_manager;
  struct zwp_virtual_keyboard_manager_v1 *keyboard_manager;
  struct wl_seat *seat;
  struct output_binding *outputs;
  struct wl_output *target_output;
  const char *target_name;
};

struct input_state {
  struct wl_display *display;
  struct zwlr_virtual_pointer_v1 *pointer;
  struct zwp_virtual_keyboard_v1 *keyboard;
  struct xkb_context *xkb_context;
  struct xkb_keymap *default_keymap;
  struct xkb_keymap *active_keymap;
  struct xkb_state *xkb_state;
  bool held_buttons[3];
  bool held_keys[MAX_KEY_CODE + 1];
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
  (void)data; (void)output; (void)flags; (void)width; (void)height; (void)refresh;
}
static void output_done(void *data, struct wl_output *output) { (void)data; (void)output; }
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
    state->pointer_manager = wl_registry_bind(
        registry, name, &zwlr_virtual_pointer_manager_v1_interface, bind_version);
    return;
  }
  if (strcmp(interface, zwp_virtual_keyboard_manager_v1_interface.name) == 0) {
    state->keyboard_manager = wl_registry_bind(
        registry, name, &zwp_virtual_keyboard_manager_v1_interface, 1);
    return;
  }
  if (strcmp(interface, wl_seat_interface.name) == 0) {
    state->seat = wl_registry_bind(registry, name, &wl_seat_interface,
                                   version < 7 ? version : 7);
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
static size_t button_index(unsigned int button) {
  return button == BTN_LEFT ? 0u : button == BTN_MIDDLE ? 1u : 2u;
}

static int create_keymap_file(const char *keymap, size_t size) {
  const char *runtime = getenv("XDG_RUNTIME_DIR");
  if (runtime == NULL || runtime[0] == '\0') return -1;
  size_t path_size = strlen(runtime) + sizeof("/omarchy-bot-keymap-XXXXXX");
  char *path = malloc(path_size);
  if (path == NULL) return -1;
  snprintf(path, path_size, "%s/omarchy-bot-keymap-XXXXXX", runtime);
  int fd = mkstemp(path);
  unlink(path);
  free(path);
  if (fd < 0 || ftruncate(fd, (off_t)size) != 0) {
    if (fd >= 0) close(fd);
    return -1;
  }
  size_t offset = 0;
  while (offset < size) {
    ssize_t written = pwrite(fd, keymap + offset, size - offset, (off_t)offset);
    if (written <= 0) { close(fd); return -1; }
    offset += (size_t)written;
  }
  return fd;
}

static bool activate_keymap(struct input_state *state, struct xkb_keymap *keymap) {
  char *text = xkb_keymap_get_as_string(keymap, XKB_KEYMAP_FORMAT_TEXT_V1);
  if (text == NULL) return false;
  size_t size = strlen(text) + 1;
  int fd = create_keymap_file(text, size);
  free(text);
  if (fd < 0) return false;
  struct xkb_state *next_state = xkb_state_new(keymap);
  if (next_state == NULL) { close(fd); return false; }
  zwp_virtual_keyboard_v1_keymap(state->keyboard,
      WL_KEYBOARD_KEYMAP_FORMAT_XKB_V1, fd, (uint32_t)size);
  close(fd);
  xkb_state_unref(state->xkb_state);
  state->xkb_state = next_state;
  state->active_keymap = keymap;
  return true;
}

static void send_modifiers(struct input_state *state) {
  xkb_mod_mask_t depressed = xkb_state_serialize_mods(
      state->xkb_state, XKB_STATE_MODS_DEPRESSED);
  xkb_mod_mask_t latched = xkb_state_serialize_mods(
      state->xkb_state, XKB_STATE_MODS_LATCHED);
  xkb_mod_mask_t locked = xkb_state_serialize_mods(
      state->xkb_state, XKB_STATE_MODS_LOCKED);
  xkb_layout_index_t group = xkb_state_serialize_layout(
      state->xkb_state, XKB_STATE_LAYOUT_EFFECTIVE);
  zwp_virtual_keyboard_v1_modifiers(state->keyboard, depressed, latched, locked, group);
}

static bool emit_key(struct input_state *state, unsigned int key, bool pressed,
                     bool enforce_transition) {
  if (key > MAX_KEY_CODE) return false;
  if (enforce_transition && state->held_keys[key] == pressed) return false;
  zwp_virtual_keyboard_v1_key(state->keyboard, monotonic_milliseconds(), key,
      pressed ? WL_KEYBOARD_KEY_STATE_PRESSED : WL_KEYBOARD_KEY_STATE_RELEASED);
  xkb_state_update_key(state->xkb_state, key + 8,
      pressed ? XKB_KEY_DOWN : XKB_KEY_UP);
  state->held_keys[key] = pressed;
  send_modifiers(state);
  return true;
}

static void release_held_keys(struct input_state *state) {
  for (unsigned int key = 0; key <= MAX_KEY_CODE; key++) {
    if (state->held_keys[key]) emit_key(state, key, false, false);
  }
}

static void release_held(struct input_state *state) {
  uint32_t now = monotonic_milliseconds();
  bool pointer_changed = false;
  const unsigned int buttons[] = { BTN_LEFT, BTN_MIDDLE, BTN_RIGHT };
  for (size_t index = 0; index < 3; index++) {
    if (!state->held_buttons[index]) continue;
    zwlr_virtual_pointer_v1_button(state->pointer, now, buttons[index],
                                   WL_POINTER_BUTTON_STATE_RELEASED);
    state->held_buttons[index] = false;
    pointer_changed = true;
  }
  if (pointer_changed) zwlr_virtual_pointer_v1_frame(state->pointer);
  release_held_keys(state);
}

static int base64_value(unsigned char input) {
  if (input >= 'A' && input <= 'Z') return input - 'A';
  if (input >= 'a' && input <= 'z') return input - 'a' + 26;
  if (input >= '0' && input <= '9') return input - '0' + 52;
  if (input == '+') return 62;
  if (input == '/') return 63;
  return -1;
}

static bool decode_base64(const char *input, unsigned char **output, size_t *output_size) {
  size_t length = strcspn(input, "\r\n");
  if (length == 0 || length % 4 != 0 || length > ((MAX_PASTE_BYTES + 2) / 3) * 4) return false;
  size_t capacity = length / 4 * 3;
  unsigned char *decoded = malloc(capacity + 1);
  if (decoded == NULL) return false;
  size_t written = 0;
  for (size_t offset = 0; offset < length; offset += 4) {
    int first = base64_value((unsigned char)input[offset]);
    int second = base64_value((unsigned char)input[offset + 1]);
    int third = input[offset + 2] == '=' ? 0 : base64_value((unsigned char)input[offset + 2]);
    int fourth = input[offset + 3] == '=' ? 0 : base64_value((unsigned char)input[offset + 3]);
    if (first < 0 || second < 0 || third < 0 || fourth < 0
        || (input[offset + 2] == '=' && input[offset + 3] != '=')
        || (offset + 4 != length && (input[offset + 2] == '=' || input[offset + 3] == '='))) {
      free(decoded); return false;
    }
    uint32_t value = (uint32_t)((first << 18) | (second << 12) | (third << 6) | fourth);
    decoded[written++] = (unsigned char)(value >> 16);
    if (input[offset + 2] != '=') decoded[written++] = (unsigned char)(value >> 8);
    if (input[offset + 3] != '=') decoded[written++] = (unsigned char)value;
  }
  if (written > MAX_PASTE_BYTES) { free(decoded); return false; }
  decoded[written] = '\0';
  *output = decoded;
  *output_size = written;
  return true;
}

static bool decode_utf8(const unsigned char *text, size_t size, size_t *offset,
                        uint32_t *codepoint) {
  unsigned char first = text[(*offset)++];
  if (first == 0 || first < 0x80) { *codepoint = first; return first != 0; }
  unsigned int continuation = first < 0xE0 ? 1 : first < 0xF0 ? 2 : first < 0xF5 ? 3 : 4;
  if (continuation == 4 || *offset + continuation > size) return false;
  uint32_t value = first & (0x7Fu >> continuation);
  for (unsigned int index = 0; index < continuation; index++) {
    unsigned char next = text[(*offset)++];
    if ((next & 0xC0u) != 0x80u) return false;
    value = (value << 6) | (next & 0x3Fu);
  }
  if ((continuation == 1 && value < 0x80) || (continuation == 2 && value < 0x800)
      || (continuation == 3 && value < 0x10000) || value > 0x10FFFF
      || (value >= 0xD800 && value <= 0xDFFF)) return false;
  *codepoint = value;
  return true;
}

static bool find_keysym(struct input_state *state, xkb_keysym_t target,
                        unsigned int *key, bool *shift) {
  xkb_keycode_t minimum = xkb_keymap_min_keycode(state->default_keymap);
  xkb_keycode_t maximum = xkb_keymap_max_keycode(state->default_keymap);
  for (xkb_keycode_t code = minimum; code <= maximum && code <= MAX_KEY_CODE + 8; code++) {
    for (xkb_level_index_t level = 0; level < 2; level++) {
      const xkb_keysym_t *symbols = NULL;
      int count = xkb_keymap_key_get_syms_by_level(state->default_keymap, code, 0, level, &symbols);
      if (count == 1 && symbols[0] == target) {
        *key = code - 8;
        *shift = level == 1;
        return true;
      }
    }
  }
  return false;
}

static bool emit_keysym(struct input_state *state, xkb_keysym_t symbol) {
  unsigned int key = 0;
  bool shift = false;
  if (!find_keysym(state, symbol, &key, &shift)) return false;
  if (shift && !emit_key(state, KEY_LEFTSHIFT, true, true)) return false;
  bool ok = emit_key(state, key, true, true) && emit_key(state, key, false, true);
  if (shift) ok = emit_key(state, KEY_LEFTSHIFT, false, true) && ok;
  return ok;
}

static bool emit_unicode_keymap(struct input_state *state, uint32_t codepoint) {
  char keymap_text[512];
  int size = snprintf(keymap_text, sizeof(keymap_text),
      "xkb_keymap { xkb_keycodes { include \"evdev+aliases(qwerty)\" }; "
      "xkb_types { include \"complete\" }; xkb_compat { include \"complete\" }; "
      "xkb_symbols { include \"pc+us\" key <FK24> { type=\"ONE_LEVEL\", symbols[Group1]=[ U%08X ] }; }; };",
      codepoint);
  if (size <= 0 || (size_t)size >= sizeof(keymap_text)) return false;
  struct xkb_keymap *temporary = xkb_keymap_new_from_string(
      state->xkb_context, keymap_text, XKB_KEYMAP_FORMAT_TEXT_V1,
      XKB_KEYMAP_COMPILE_NO_FLAGS);
  if (temporary == NULL || !activate_keymap(state, temporary)) {
    xkb_keymap_unref(temporary);
    return false;
  }
  bool ok = emit_key(state, KEY_F24, true, true) && emit_key(state, KEY_F24, false, true);
  if (!activate_keymap(state, state->default_keymap)) ok = false;
  xkb_keymap_unref(temporary);
  return ok;
}

static bool paste_text(struct input_state *state, const unsigned char *text, size_t size) {
  bool held_keys[MAX_KEY_CODE + 1];
  memcpy(held_keys, state->held_keys, sizeof(held_keys));
  release_held_keys(state);
  bool ok = true;
  size_t offset = 0;
  while (offset < size) {
    uint32_t codepoint = 0;
    if (!decode_utf8(text, size, &offset, &codepoint)) { ok = false; break; }
    xkb_keysym_t symbol = codepoint == '\n' || codepoint == '\r'
        ? XKB_KEY_Return : codepoint == '\t' ? XKB_KEY_Tab : xkb_utf32_to_keysym(codepoint);
    if (symbol == XKB_KEY_NoSymbol
        || (!emit_keysym(state, symbol) && !emit_unicode_keymap(state, codepoint))) {
      ok = false;
      break;
    }
  }
  if (state->active_keymap != state->default_keymap
      && !activate_keymap(state, state->default_keymap)) ok = false;
  for (unsigned int key = 0; key <= MAX_KEY_CODE; key++) {
    if (held_keys[key] && !emit_key(state, key, true, true)) ok = false;
  }
  return ok;
}

static int fixture_loop(void) {
  char line[131072];
  puts("READY fixture");
  fflush(stdout);
  while (fgets(line, sizeof(line), stdin) != NULL) {
    unsigned long long sequence = 0;
    if (!parse_sequence(line, &sequence)) { puts("ERR malformed"); fflush(stdout); continue; }
    const char *kind = strncmp(line, "motion ", 7) == 0 ? "motion"
        : strncmp(line, "button ", 7) == 0 ? "button"
        : strncmp(line, "scroll ", 7) == 0 ? "scroll"
        : strncmp(line, "key ", 4) == 0 ? "key"
        : strncmp(line, "paste ", 6) == 0 ? "paste"
        : strncmp(line, "release ", 8) == 0 ? "release" : NULL;
    if (kind == NULL) printf("ERR %llu unknown\n", sequence);
    else printf("OK %llu %s\n", sequence, kind);
    fflush(stdout);
  }
  return 0;
}

static int command_loop(struct input_state *state) {
  char line[131072];
  unsigned long long last_sequence = 0;
  printf("READY\n");
  fflush(stdout);
  while (fgets(line, sizeof(line), stdin) != NULL) {
    unsigned long long sequence = 0;
    if (!parse_sequence(line, &sequence) || sequence <= last_sequence) return 2;
    uint32_t now = monotonic_milliseconds();
    if (strncmp(line, "motion ", 7) == 0) {
      double x = 0, y = 0; unsigned int width = 0, height = 0;
      if (sscanf(line, "motion %llu %lf %lf %u %u", &sequence, &x, &y, &width, &height) != 5
          || !isfinite(x) || !isfinite(y) || width == 0 || height == 0
          || x < 0 || y < 0 || x >= width || y >= height) return 2;
      zwlr_virtual_pointer_v1_motion_absolute(state->pointer, now,
          (uint32_t)llround(x * COORDINATE_SCALE), (uint32_t)llround(y * COORDINATE_SCALE),
          (uint32_t)llround(width * COORDINATE_SCALE), (uint32_t)llround(height * COORDINATE_SCALE));
      zwlr_virtual_pointer_v1_frame(state->pointer);
    } else if (strncmp(line, "button ", 7) == 0) {
      unsigned int button = 0, pressed = 0;
      if (sscanf(line, "button %llu %u %u", &sequence, &button, &pressed) != 3
          || !supported_button(button) || pressed > 1
          || state->held_buttons[button_index(button)] == (pressed != 0)) return 2;
      zwlr_virtual_pointer_v1_button(state->pointer, now, button,
          pressed ? WL_POINTER_BUTTON_STATE_PRESSED : WL_POINTER_BUTTON_STATE_RELEASED);
      zwlr_virtual_pointer_v1_frame(state->pointer);
      state->held_buttons[button_index(button)] = pressed != 0;
    } else if (strncmp(line, "scroll ", 7) == 0) {
      double delta_x = 0, delta_y = 0;
      if (sscanf(line, "scroll %llu %lf %lf", &sequence, &delta_x, &delta_y) != 3
          || !isfinite(delta_x) || !isfinite(delta_y) || (delta_x == 0 && delta_y == 0)) return 2;
      zwlr_virtual_pointer_v1_axis_source(state->pointer, WL_POINTER_AXIS_SOURCE_WHEEL);
      if (delta_x != 0) zwlr_virtual_pointer_v1_axis(state->pointer, now,
          WL_POINTER_AXIS_HORIZONTAL_SCROLL, wl_fixed_from_double(delta_x / SCROLL_SCALE));
      if (delta_y != 0) zwlr_virtual_pointer_v1_axis(state->pointer, now,
          WL_POINTER_AXIS_VERTICAL_SCROLL, wl_fixed_from_double(delta_y / SCROLL_SCALE));
      zwlr_virtual_pointer_v1_frame(state->pointer);
    } else if (strncmp(line, "key ", 4) == 0) {
      unsigned int key = 0, pressed = 0;
      if (sscanf(line, "key %llu %u %u", &sequence, &key, &pressed) != 3
          || pressed > 1 || !emit_key(state, key, pressed != 0, true)) return 2;
    } else if (strncmp(line, "paste ", 6) == 0) {
      char *encoded = strchr(strchr(line, ' ') + 1, ' ');
      unsigned char *decoded = NULL; size_t decoded_size = 0;
      if (encoded == NULL || !decode_base64(encoded + 1, &decoded, &decoded_size)
          || !paste_text(state, decoded, decoded_size)) { free(decoded); return 2; }
      free(decoded);
    } else if (strncmp(line, "release ", 8) == 0) {
      release_held(state);
    } else return 2;
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
    fprintf(stderr, "usage: %s OUTPUT_NAME\n", argv[0]); return 2;
  }
  struct registry_state registry_state = { .target_name = argv[1] };
  registry_state.display = wl_display_connect(NULL);
  if (registry_state.display == NULL) return 3;
  struct wl_registry *registry = wl_display_get_registry(registry_state.display);
  wl_registry_add_listener(registry, &registry_listener, &registry_state);
  if (wl_display_roundtrip(registry_state.display) < 0
      || wl_display_roundtrip(registry_state.display) < 0) return 3;
  for (struct output_binding *binding = registry_state.outputs; binding != NULL; binding = binding->next) {
    if (binding->matched) { registry_state.target_output = binding->output; break; }
  }
  if (registry_state.pointer_manager == NULL || registry_state.keyboard_manager == NULL
      || registry_state.seat == NULL || registry_state.target_output == NULL
      || zwlr_virtual_pointer_manager_v1_get_version(registry_state.pointer_manager) < 2) {
    fprintf(stderr, "assigned output, seat, virtual pointer, or virtual keyboard is unavailable\n");
    return 4;
  }
  struct xkb_context *xkb_context = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
  const struct xkb_rule_names names = { .layout = "us" };
  struct xkb_keymap *keymap = xkb_context == NULL ? NULL : xkb_keymap_new_from_names(
      xkb_context, &names, XKB_KEYMAP_COMPILE_NO_FLAGS);
  if (keymap == NULL) return 4;
  struct input_state input_state = {
    .display = registry_state.display,
    .pointer = zwlr_virtual_pointer_manager_v1_create_virtual_pointer_with_output(
        registry_state.pointer_manager, NULL, registry_state.target_output),
    .keyboard = zwp_virtual_keyboard_manager_v1_create_virtual_keyboard(
        registry_state.keyboard_manager, registry_state.seat),
    .xkb_context = xkb_context,
    .default_keymap = keymap,
  };
  if (!activate_keymap(&input_state, keymap) || wl_display_roundtrip(registry_state.display) < 0) return 3;
  int result = command_loop(&input_state);
  release_held(&input_state);
  zwp_virtual_keyboard_v1_destroy(input_state.keyboard);
  zwlr_virtual_pointer_v1_destroy(input_state.pointer);
  xkb_state_unref(input_state.xkb_state);
  xkb_keymap_unref(keymap);
  xkb_context_unref(xkb_context);
  zwp_virtual_keyboard_manager_v1_destroy(registry_state.keyboard_manager);
  zwlr_virtual_pointer_manager_v1_destroy(registry_state.pointer_manager);
  wl_seat_destroy(registry_state.seat);
  wl_registry_destroy(registry);
  wl_display_disconnect(registry_state.display);
  return result;
}
