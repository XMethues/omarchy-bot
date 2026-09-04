#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <wayland-client.h>

#include "xdg-shell-client-protocol.h"

struct desktop {
  struct wl_display *display;
  struct wl_compositor *compositor;
  struct wl_shm *shm;
  struct xdg_wm_base *wm_base;
  struct wl_surface *surface;
  struct xdg_surface *xdg_surface;
  struct xdg_toplevel *toplevel;
  struct wl_buffer *buffer;
  void *pixels;
  size_t pixels_size;
  int logical_width;
  int logical_height;
  int video_width;
  int video_height;
  int scale;
  int configured_width;
  int configured_height;
  int ready_reported;
};

static int create_shm_file(size_t size) {
  int fd = memfd_create("omarchy-bot-desktop", MFD_CLOEXEC);
  if (fd < 0) return -1;
  if (ftruncate(fd, (off_t)size) != 0) {
    close(fd);
    return -1;
  }
  return fd;
}

static int create_neutral_buffer(struct desktop *desktop) {
  const int stride = desktop->video_width * 4;
  desktop->pixels_size = (size_t)stride * (size_t)desktop->video_height;
  int fd = create_shm_file(desktop->pixels_size);
  if (fd < 0) return -1;
  desktop->pixels = mmap(NULL, desktop->pixels_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if (desktop->pixels == MAP_FAILED) {
    desktop->pixels = NULL;
    close(fd);
    return -1;
  }

  uint32_t *pixel = desktop->pixels;
  const size_t count = desktop->pixels_size / sizeof(uint32_t);
  for (size_t index = 0; index < count; index++) pixel[index] = 0xff20242b;

  struct wl_shm_pool *pool = wl_shm_create_pool(desktop->shm, fd, (int)desktop->pixels_size);
  close(fd);
  if (pool == NULL) return -1;
  desktop->buffer = wl_shm_pool_create_buffer(
    pool,
    0,
    desktop->video_width,
    desktop->video_height,
    stride,
    WL_SHM_FORMAT_XRGB8888
  );
  wl_shm_pool_destroy(pool);
  return desktop->buffer == NULL ? -1 : 0;
}

static void wm_base_ping(void *data, struct xdg_wm_base *wm_base, uint32_t serial) {
  (void)data;
  xdg_wm_base_pong(wm_base, serial);
}

static const struct xdg_wm_base_listener wm_base_listener = {
  .ping = wm_base_ping,
};

static void toplevel_configure(
  void *data,
  struct xdg_toplevel *toplevel,
  int32_t width,
  int32_t height,
  struct wl_array *states
) {
  (void)toplevel;
  (void)states;
  struct desktop *desktop = data;
  if (width > 0) desktop->configured_width = width;
  if (height > 0) desktop->configured_height = height;
}

static void toplevel_close(void *data, struct xdg_toplevel *toplevel) {
  (void)data;
  (void)toplevel;
}

static const struct xdg_toplevel_listener toplevel_listener = {
  .configure = toplevel_configure,
  .close = toplevel_close,
};

static void surface_configure(void *data, struct xdg_surface *xdg_surface, uint32_t serial) {
  struct desktop *desktop = data;
  xdg_surface_ack_configure(xdg_surface, serial);
  wl_surface_attach(desktop->surface, desktop->buffer, 0, 0);
  wl_surface_damage_buffer(desktop->surface, 0, 0, desktop->video_width, desktop->video_height);
  wl_surface_commit(desktop->surface);
  if (
    !desktop->ready_reported
    && desktop->configured_width == desktop->logical_width
    && desktop->configured_height == desktop->logical_height
  ) {
    desktop->ready_reported = 1;
    printf("READY %d %d\n", desktop->configured_width, desktop->configured_height);
    fflush(stdout);
  }
}

static const struct xdg_surface_listener surface_listener = {
  .configure = surface_configure,
};

static void registry_global(
  void *data,
  struct wl_registry *registry,
  uint32_t name,
  const char *interface,
  uint32_t version
) {
  struct desktop *desktop = data;
  if (strcmp(interface, wl_compositor_interface.name) == 0) {
    desktop->compositor = wl_registry_bind(registry, name, &wl_compositor_interface, version < 4 ? version : 4);
  } else if (strcmp(interface, wl_shm_interface.name) == 0) {
    desktop->shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
  } else if (strcmp(interface, xdg_wm_base_interface.name) == 0) {
    desktop->wm_base = wl_registry_bind(registry, name, &xdg_wm_base_interface, 1);
  }
}

static void registry_remove(void *data, struct wl_registry *registry, uint32_t name) {
  (void)data;
  (void)registry;
  (void)name;
}

static const struct wl_registry_listener registry_listener = {
  .global = registry_global,
  .global_remove = registry_remove,
};

static int positive_int(const char *value) {
  char *end = NULL;
  errno = 0;
  long parsed = strtol(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0' || parsed < 1 || parsed > INT32_MAX) return -1;
  return (int)parsed;
}

int main(int argc, char **argv) {
  if (argc != 4) {
    fprintf(stderr, "usage: %s <logical-width> <logical-height> <scale>\n", argv[0]);
    return 2;
  }
  struct desktop desktop = {
    .logical_width = positive_int(argv[1]),
    .logical_height = positive_int(argv[2]),
    .scale = positive_int(argv[3]),
  };
  if (desktop.logical_width < 1 || desktop.logical_height < 1 || desktop.scale < 1) {
    fprintf(stderr, "Bot Desktop geometry must use positive integers\n");
    return 2;
  }
  desktop.video_width = desktop.logical_width * desktop.scale;
  desktop.video_height = desktop.logical_height * desktop.scale;
  desktop.display = wl_display_connect(NULL);
  if (desktop.display == NULL) {
    fprintf(stderr, "Bot Desktop could not connect to its Wayland display\n");
    return 1;
  }
  struct wl_registry *registry = wl_display_get_registry(desktop.display);
  wl_registry_add_listener(registry, &registry_listener, &desktop);
  if (wl_display_roundtrip(desktop.display) < 0 || desktop.compositor == NULL || desktop.shm == NULL || desktop.wm_base == NULL) {
    fprintf(stderr, "Bot Desktop compositor is missing required Wayland protocols\n");
    return 1;
  }
  xdg_wm_base_add_listener(desktop.wm_base, &wm_base_listener, &desktop);
  if (create_neutral_buffer(&desktop) != 0) {
    fprintf(stderr, "Bot Desktop could not allocate its neutral surface\n");
    return 1;
  }

  desktop.surface = wl_compositor_create_surface(desktop.compositor);
  wl_surface_set_buffer_scale(desktop.surface, desktop.scale);
  desktop.xdg_surface = xdg_wm_base_get_xdg_surface(desktop.wm_base, desktop.surface);
  xdg_surface_add_listener(desktop.xdg_surface, &surface_listener, &desktop);
  desktop.toplevel = xdg_surface_get_toplevel(desktop.xdg_surface);
  xdg_toplevel_add_listener(desktop.toplevel, &toplevel_listener, &desktop);
  xdg_toplevel_set_title(desktop.toplevel, "Bot Desktop");
  xdg_toplevel_set_app_id(desktop.toplevel, "dev.omarchy.BotDesktop");
  xdg_toplevel_set_fullscreen(desktop.toplevel, NULL);
  wl_surface_commit(desktop.surface);

  while (wl_display_dispatch(desktop.display) >= 0) {}

  xdg_toplevel_destroy(desktop.toplevel);
  xdg_surface_destroy(desktop.xdg_surface);
  wl_surface_destroy(desktop.surface);
  wl_buffer_destroy(desktop.buffer);
  munmap(desktop.pixels, desktop.pixels_size);
  xdg_wm_base_destroy(desktop.wm_base);
  wl_shm_destroy(desktop.shm);
  wl_compositor_destroy(desktop.compositor);
  wl_registry_destroy(registry);
  wl_display_disconnect(desktop.display);
  return 0;
}
