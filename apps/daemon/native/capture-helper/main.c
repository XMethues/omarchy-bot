#define _GNU_SOURCE

#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include <wayland-client.h>

#include "wlr-screencopy-unstable-v1-client-protocol.h"

struct output {
  struct wl_output *proxy;
  uint32_t global_name;
  char *name;
  bool removed;
  struct output *next;
};

struct helper {
  struct wl_display *display;
  struct wl_registry *registry;
  struct wl_shm *shm;
  struct zwlr_screencopy_manager_v1 *manager;
  uint32_t manager_version;
  struct output *outputs;
  struct output *selected;
};

struct capture {
  struct helper *helper;
  struct zwlr_screencopy_frame_v1 *frame;
  struct wl_buffer *buffer;
  void *data;
  size_t size;
  uint32_t format;
  uint32_t width;
  uint32_t height;
  uint32_t stride;
  uint32_t flags;
  bool copy_requested;
  bool done;
  bool failed;
};

static uint32_t minimum(uint32_t left, uint32_t right) {
  return left < right ? left : right;
}

static void output_geometry(
  void *data,
  struct wl_output *output,
  int32_t x,
  int32_t y,
  int32_t physical_width,
  int32_t physical_height,
  int32_t subpixel,
  const char *make,
  const char *model,
  int32_t transform
) {
  (void)data;
  (void)output;
  (void)x;
  (void)y;
  (void)physical_width;
  (void)physical_height;
  (void)subpixel;
  (void)make;
  (void)model;
  (void)transform;
}

static void output_mode(
  void *data,
  struct wl_output *output,
  uint32_t flags,
  int32_t width,
  int32_t height,
  int32_t refresh
) {
  (void)data;
  (void)output;
  (void)flags;
  (void)width;
  (void)height;
  (void)refresh;
}

static void output_done(void *data, struct wl_output *output) {
  (void)data;
  (void)output;
}

static void output_scale(void *data, struct wl_output *output, int32_t factor) {
  (void)data;
  (void)output;
  (void)factor;
}

static void output_name(void *data, struct wl_output *output, const char *name) {
  (void)output;
  struct output *candidate = data;
  free(candidate->name);
  candidate->name = strdup(name);
}

static void output_description(void *data, struct wl_output *output, const char *description) {
  (void)data;
  (void)output;
  (void)description;
}

static const struct wl_output_listener output_listener = {
  .geometry = output_geometry,
  .mode = output_mode,
  .done = output_done,
  .scale = output_scale,
  .name = output_name,
  .description = output_description,
};

static void registry_global(
  void *data,
  struct wl_registry *registry,
  uint32_t name,
  const char *interface,
  uint32_t version
) {
  struct helper *helper = data;
  if (strcmp(interface, zwlr_screencopy_manager_v1_interface.name) == 0) {
    helper->manager_version = minimum(version, 3);
    helper->manager = wl_registry_bind(
      registry,
      name,
      &zwlr_screencopy_manager_v1_interface,
      helper->manager_version
    );
    return;
  }
  if (strcmp(interface, wl_shm_interface.name) == 0) {
    helper->shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
    return;
  }
  if (strcmp(interface, wl_output_interface.name) != 0) return;

  struct output *output = calloc(1, sizeof(*output));
  if (output == NULL) return;
  output->global_name = name;
  output->proxy = wl_registry_bind(registry, name, &wl_output_interface, minimum(version, 4));
  output->next = helper->outputs;
  helper->outputs = output;
  wl_output_add_listener(output->proxy, &output_listener, output);
}

static void registry_global_remove(void *data, struct wl_registry *registry, uint32_t name) {
  (void)registry;
  struct helper *helper = data;
  for (struct output *output = helper->outputs; output != NULL; output = output->next) {
    if (output->global_name != name) continue;
    output->removed = true;
    return;
  }
}

static const struct wl_registry_listener registry_listener = {
  .global = registry_global,
  .global_remove = registry_global_remove,
};

static void capture_cleanup(struct capture *capture) {
  if (capture->frame != NULL) zwlr_screencopy_frame_v1_destroy(capture->frame);
  if (capture->buffer != NULL) wl_buffer_destroy(capture->buffer);
  if (capture->data != NULL) munmap(capture->data, capture->size);
}

static void request_copy(struct capture *capture) {
  if (capture->copy_requested || capture->failed) return;
  if (
    capture->width == 0
    || capture->height == 0
    || capture->width > INT32_MAX
    || capture->height > INT32_MAX
    || capture->width > UINT32_MAX / 4
    || capture->stride < capture->width * 4
    || capture->stride > INT32_MAX
    || (
      capture->format != WL_SHM_FORMAT_ARGB8888
      && capture->format != WL_SHM_FORMAT_XRGB8888
      && capture->format != WL_SHM_FORMAT_ABGR8888
      && capture->format != WL_SHM_FORMAT_XBGR8888
    )
  ) {
    if (
      capture->format != WL_SHM_FORMAT_ARGB8888
      && capture->format != WL_SHM_FORMAT_XRGB8888
      && capture->format != WL_SHM_FORMAT_ABGR8888
      && capture->format != WL_SHM_FORMAT_XBGR8888
    ) {
      fprintf(stderr, "unsupported shared-memory frame format 0x%08x\n", capture->format);
    }
    capture->failed = true;
    capture->done = true;
    return;
  }
  if (capture->height > SIZE_MAX / capture->stride) {
    capture->failed = true;
    capture->done = true;
    return;
  }

  capture->size = (size_t)capture->height * capture->stride;
  if (capture->size > INT32_MAX) {
    capture->failed = true;
    capture->done = true;
    return;
  }
  int fd = memfd_create("omarchy-bot-screen-capture", MFD_CLOEXEC);
  if (fd < 0 || ftruncate(fd, (off_t)capture->size) != 0) {
    if (fd >= 0) close(fd);
    capture->failed = true;
    capture->done = true;
    return;
  }
  capture->data = mmap(NULL, capture->size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if (capture->data == MAP_FAILED) {
    capture->data = NULL;
    close(fd);
    capture->failed = true;
    capture->done = true;
    return;
  }

  struct wl_shm_pool *pool = wl_shm_create_pool(capture->helper->shm, fd, (int32_t)capture->size);
  capture->buffer = wl_shm_pool_create_buffer(
    pool,
    0,
    (int32_t)capture->width,
    (int32_t)capture->height,
    (int32_t)capture->stride,
    capture->format
  );
  wl_shm_pool_destroy(pool);
  close(fd);
  capture->copy_requested = true;
  zwlr_screencopy_frame_v1_copy(capture->frame, capture->buffer);
}

static void frame_buffer(
  void *data,
  struct zwlr_screencopy_frame_v1 *frame,
  uint32_t format,
  uint32_t width,
  uint32_t height,
  uint32_t stride
) {
  (void)frame;
  struct capture *capture = data;
  capture->format = format;
  capture->width = width;
  capture->height = height;
  capture->stride = stride;
  if (capture->helper->manager_version < 3) request_copy(capture);
}

static void frame_flags(void *data, struct zwlr_screencopy_frame_v1 *frame, uint32_t flags) {
  (void)frame;
  struct capture *capture = data;
  capture->flags = flags;
}

static void frame_ready(
  void *data,
  struct zwlr_screencopy_frame_v1 *frame,
  uint32_t tv_sec_hi,
  uint32_t tv_sec_lo,
  uint32_t tv_nsec
) {
  (void)frame;
  (void)tv_sec_hi;
  (void)tv_sec_lo;
  (void)tv_nsec;
  struct capture *capture = data;
  capture->done = true;
}

static void frame_failed(void *data, struct zwlr_screencopy_frame_v1 *frame) {
  (void)frame;
  struct capture *capture = data;
  capture->failed = true;
  capture->done = true;
}

static void frame_damage(
  void *data,
  struct zwlr_screencopy_frame_v1 *frame,
  uint32_t x,
  uint32_t y,
  uint32_t width,
  uint32_t height
) {
  (void)data;
  (void)frame;
  (void)x;
  (void)y;
  (void)width;
  (void)height;
}

static void frame_linux_dmabuf(
  void *data,
  struct zwlr_screencopy_frame_v1 *frame,
  uint32_t format,
  uint32_t width,
  uint32_t height
) {
  (void)data;
  (void)frame;
  (void)format;
  (void)width;
  (void)height;
}

static void frame_buffer_done(void *data, struct zwlr_screencopy_frame_v1 *frame) {
  (void)frame;
  request_copy(data);
}

static const struct zwlr_screencopy_frame_v1_listener frame_listener = {
  .buffer = frame_buffer,
  .flags = frame_flags,
  .ready = frame_ready,
  .failed = frame_failed,
  .damage = frame_damage,
  .linux_dmabuf = frame_linux_dmabuf,
  .buffer_done = frame_buffer_done,
};

static bool write_all(const void *data, size_t length) {
  const uint8_t *cursor = data;
  while (length > 0) {
    size_t written = fwrite(cursor, 1, length, stdout);
    if (written == 0) return false;
    cursor += written;
    length -= written;
  }
  return true;
}

static bool emit_capture(struct capture *capture) {
  size_t packed_size = (size_t)capture->width * capture->height * 4;
  if (fprintf(stdout, "FRAME %u %u %zu\n", capture->width, capture->height, packed_size) < 0) return false;

  for (uint32_t y = 0; y < capture->height; y += 1) {
    uint32_t source_y = (capture->flags & ZWLR_SCREENCOPY_FRAME_V1_FLAGS_Y_INVERT) != 0
      ? capture->height - y - 1
      : y;
    uint8_t *row = (uint8_t *)capture->data + (size_t)source_y * capture->stride;
    for (uint32_t x = 0; x < capture->width; x += 1) {
      if (capture->format == WL_SHM_FORMAT_ARGB8888 || capture->format == WL_SHM_FORMAT_XRGB8888) {
        uint8_t blue = row[x * 4];
        row[x * 4] = row[x * 4 + 2];
        row[x * 4 + 2] = blue;
      }
      if (capture->format == WL_SHM_FORMAT_XRGB8888 || capture->format == WL_SHM_FORMAT_XBGR8888) {
        row[x * 4 + 3] = 0xff;
      }
    }
    if (!write_all(row, (size_t)capture->width * 4)) return false;
  }
  return fflush(stdout) == 0;
}

static bool capture_output(struct helper *helper) {
  if (helper->selected->removed) {
    fprintf(stderr, "assigned Bot Screen output is unavailable\n");
    return false;
  }

  struct capture capture = { .helper = helper };
  capture.frame = zwlr_screencopy_manager_v1_capture_output(
    helper->manager,
    0,
    helper->selected->proxy
  );
  zwlr_screencopy_frame_v1_add_listener(capture.frame, &frame_listener, &capture);
  while (!capture.done) {
    if (wl_display_dispatch(helper->display) < 0) {
      capture.failed = true;
      capture.done = true;
    }
  }

  bool emitted = !capture.failed && emit_capture(&capture);
  capture_cleanup(&capture);
  if (!emitted) fprintf(stderr, "assigned Bot Screen capture failed\n");
  return emitted;
}

static void helper_cleanup(struct helper *helper) {
  struct output *output = helper->outputs;
  while (output != NULL) {
    struct output *next = output->next;
    if (output->proxy != NULL) wl_output_destroy(output->proxy);
    free(output->name);
    free(output);
    output = next;
  }
  if (helper->manager != NULL) zwlr_screencopy_manager_v1_destroy(helper->manager);
  if (helper->shm != NULL) wl_shm_destroy(helper->shm);
  if (helper->registry != NULL) wl_registry_destroy(helper->registry);
  if (helper->display != NULL) wl_display_disconnect(helper->display);
}

int main(int argc, char **argv) {
  if (argc != 2 || argv[1][0] == '\0') {
    fprintf(stderr, "usage: omarchy-bot-wayland-capture OUTPUT\n");
    return 2;
  }
  signal(SIGPIPE, SIG_IGN);

  struct helper helper = {0};
  helper.display = wl_display_connect(NULL);
  if (helper.display == NULL) {
    fprintf(stderr, "could not connect to the assigned Bot Screen Wayland socket\n");
    return 1;
  }
  helper.registry = wl_display_get_registry(helper.display);
  wl_registry_add_listener(helper.registry, &registry_listener, &helper);
  if (wl_display_roundtrip(helper.display) < 0 || wl_display_roundtrip(helper.display) < 0) {
    fprintf(stderr, "could not inspect the assigned Bot Screen outputs\n");
    helper_cleanup(&helper);
    return 1;
  }
  if (helper.manager == NULL || helper.shm == NULL) {
    fprintf(stderr, "assigned Bot Screen does not provide screencopy and shared memory\n");
    helper_cleanup(&helper);
    return 1;
  }
  for (struct output *output = helper.outputs; output != NULL; output = output->next) {
    if (!output->removed && output->name != NULL && strcmp(output->name, argv[1]) == 0) {
      helper.selected = output;
      break;
    }
  }
  if (helper.selected == NULL) {
    fprintf(stderr, "assigned Bot Screen output was not found\n");
    helper_cleanup(&helper);
    return 1;
  }

  puts("READY");
  fflush(stdout);
  char *line = NULL;
  size_t capacity = 0;
  bool healthy = true;
  while (healthy && getline(&line, &capacity, stdin) >= 0) {
    if (strcmp(line, "capture\n") == 0) healthy = capture_output(&helper);
    else if (strcmp(line, "close\n") == 0) break;
    else {
      fprintf(stderr, "invalid capture request\n");
      healthy = false;
    }
  }
  free(line);
  helper_cleanup(&helper);
  return healthy ? 0 : 1;
}
