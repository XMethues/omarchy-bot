export {};

const themeSelect = document.querySelector<HTMLSelectElement>("#theme-select");
if (themeSelect) {
  themeSelect.value = document.documentElement.dataset.theme ?? "system";
  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      if (theme === "system") localStorage.removeItem("omarchy-site-theme");
      else localStorage.setItem("omarchy-site-theme", theme);
    } catch {
      // The selected theme still works when browser storage is unavailable.
    }
  });
}

const menuToggle = document.querySelector<HTMLButtonElement>("#menu-toggle");
const mobileNav = document.querySelector<HTMLElement>("#mobile-nav");
if (menuToggle && mobileNav) {
  menuToggle.hidden = false;
  const closeMenu = () => {
    mobileNav.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.textContent = "Menu";
  };
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    mobileNav.hidden = isOpen;
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.textContent = isOpen ? "Menu" : "Close";
  });
  mobileNav.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a"))
      closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !mobileNav.hidden) {
      closeMenu();
      menuToggle.focus();
    }
  });
  window
    .matchMedia("(min-width: 768px)")
    .addEventListener("change", (event) => {
      if (event.matches) closeMenu();
    });
}

const copyButton = document.querySelector<HTMLButtonElement>("#copy-install");
const command = document.querySelector<HTMLElement>("#install-command");
const copyStatus = document.querySelector<HTMLElement>("#copy-status");
if (copyButton && command && copyStatus) {
  copyButton.hidden = false;
  copyButton.addEventListener("click", async () => {
    copyButton.disabled = true;
    try {
      await navigator.clipboard.writeText(command.textContent?.trim() ?? "");
      copyStatus.textContent =
        "Copied. Paste into your Omarchy terminal when you're ready.";
      copyButton.textContent = "Copied";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(command);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      copyStatus.textContent =
        "Clipboard unavailable. The command is selected; copy it manually.";
      copyButton.textContent = "Copy command";
    } finally {
      copyButton.disabled = false;
    }
  });
}
