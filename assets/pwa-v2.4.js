(() => {
  "use strict";

  const banner = document.getElementById("pwaInstallBar");
  const installButton = document.getElementById("pwaInstallButton");
  const dismissButton = document.getElementById("pwaInstallDismiss");
  const dialog = document.getElementById("pwaInstallDialog");
  const dialogTitle = document.getElementById("pwaDialogTitle");
  const dialogText = document.getElementById("pwaDialogText");
  const steps = document.getElementById("pwaInstallSteps");
  const dialogCloseButtons = [...document.querySelectorAll("[data-pwa-close]")];
  const installTitle = document.getElementById("pwaInstallTitle");
  const installText = document.getElementById("pwaInstallText");
  const runtimeStatus = document.getElementById("pwaRuntimeStatus");
  const runtimeItem = runtimeStatus?.closest(".footer-runtime");

  if (!banner || !installButton || !dialog || !steps) return;

  const appName = document.querySelector('meta[name="application-name"]')?.content || document.title;
  const secureContext = location.protocol === "https:" || ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMac = /Macintosh|Mac OS X/.test(ua) && !isIOS;
  const isSafari = /Safari/.test(ua) && !/(Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|Opera|FxiOS|Firefox)/.test(ua);
  const isFirefox = /Firefox|FxiOS/.test(ua);
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const dismissKey = `pwa-install-dismissed-until:${location.hostname}`;
  const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
  let deferredPrompt = null;
  let reloadingForUpdate = false;
  let updateRequested = false;

  function setRuntimeStatus(text, state = "ready") {
    if (!runtimeStatus) return;
    runtimeStatus.textContent = text;
    if (runtimeItem) runtimeItem.dataset.state = state;
  }

  function hasDismissed() {
    try { return Number(localStorage.getItem(dismissKey) || 0) > Date.now(); }
    catch (_) { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(dismissKey, String(Date.now() + DISMISS_MS)); }
    catch (_) {}
  }

  function showBanner(mode = "instructions") {
    if (!secureContext || isStandalone() || hasDismissed()) return;

    if (mode === "native") {
      installTitle.textContent = "Установить приложение";
      installText.textContent = "Быстрый запуск и работа без интернета.";
      installButton.textContent = "Установить";
    } else if (isIOS) {
      installTitle.textContent = "Добавить на экран «Домой»";
      installText.textContent = "Открывайте сервис как отдельное приложение.";
      installButton.textContent = "Как добавить";
    } else if (isMac && isSafari) {
      installTitle.textContent = "Добавить приложение в Dock";
      installText.textContent = "Быстрый запуск из Dock и отдельное окно.";
      installButton.textContent = "Как добавить";
    } else if (isFirefox) {
      return;
    } else {
      installTitle.textContent = "Использовать как приложение";
      installText.textContent = "Быстрый запуск и автономная работа.";
      installButton.textContent = "Подробнее";
    }

    banner.hidden = false;
  }

  function hideBanner({ dismiss = false } = {}) {
    banner.hidden = true;
    if (dismiss) markDismissed();
  }

  function fillInstructions() {
    steps.replaceChildren();
    const list = [];

    if (isIOS && isSafari) {
      dialogTitle.textContent = "Добавить на экран «Домой»";
      dialogText.textContent = `Safari установит «${appName}» как отдельное веб-приложение.`;
      list.push("Нажмите кнопку «Поделиться» в панели Safari.");
      list.push("Выберите «На экран Домой».");
      list.push("Подтвердите название и нажмите «Добавить».");
    } else if (isMac && isSafari) {
      dialogTitle.textContent = "Добавить приложение в Dock";
      dialogText.textContent = `Safari создаст отдельное приложение «${appName}» с собственной иконкой.`;
      list.push("Откройте меню «Файл» в Safari.");
      list.push("Выберите «Добавить в Dock…».");
      list.push("Проверьте название и нажмите «Добавить».");
    } else {
      dialogTitle.textContent = "Установить приложение";
      dialogText.textContent = `Добавьте «${appName}» на устройство для быстрого запуска.`;
      list.push("Откройте меню браузера.");
      list.push("Выберите «Установить приложение» или «Добавить на главный экран».");
      list.push("Подтвердите установку.");
    }

    list.forEach(value => {
      const item = document.createElement("li");
      item.textContent = value;
      steps.appendChild(item);
    });
  }

  function openDialog() {
    fillInstructions();
    dialog.hidden = false;
    document.body.classList.add("pwa-dialog-open");
    dialog.querySelector(".pwa-dialog-close")?.focus();
  }

  function closeDialog() {
    dialog.hidden = true;
    document.body.classList.remove("pwa-dialog-open");
    installButton.focus({ preventScroll: true });
  }

  async function install() {
    if (!deferredPrompt) {
      openDialog();
      return;
    }

    installButton.disabled = true;
    const oldText = installButton.textContent;
    installButton.textContent = "Открываем…";

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === "accepted") hideBanner();
      deferredPrompt = null;
    } catch (error) {
      console.warn("Не удалось открыть системный диалог установки:", error);
      openDialog();
    } finally {
      installButton.disabled = false;
      installButton.textContent = oldText;
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !secureContext) {
      setRuntimeStatus("Автономный режим недоступен", "error");
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", {
        scope: "./",
        updateViaCache: "none"
      });
      const notifyUpdate = worker => {
        if (!worker || !navigator.serviceWorker.controller) return;
        setRuntimeStatus("Доступно обновление", "update");
        window.dispatchEvent(new CustomEvent("acts:pwa-update", { detail: {
          apply: () => {
            updateRequested = true;
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        } }));
      };
      if (registration.waiting) notifyUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") notifyUpdate(registration.waiting || worker);
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!updateRequested || reloadingForUpdate) return;
        reloadingForUpdate = true;
        location.reload();
      });
      await navigator.serviceWorker.ready;
      setRuntimeStatus(navigator.onLine ? "Готово к работе без интернета" : "Работаем без интернета", "ready");
      registration.update().catch(() => {});
    } catch (error) {
      console.warn("Не удалось включить автономный режим:", error);
      setRuntimeStatus("Автономный режим не включен", "error");
    }
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    showBanner("native");
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideBanner();
  });

  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", event => {
    if (event.matches) hideBanner();
  });

  installButton.addEventListener("click", install);
  dismissButton?.addEventListener("click", () => hideBanner({ dismiss: true }));
  dialogCloseButtons.forEach(button => button.addEventListener("click", closeDialog));
  dialog.addEventListener("click", event => {
    if (event.target === dialog) closeDialog();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !dialog.hidden) closeDialog();
  });

  registerServiceWorker();

  window.addEventListener("offline", () => setRuntimeStatus("Работаем без интернета", "ready"));
  window.addEventListener("online", () => setRuntimeStatus("Готово к работе без интернета", "ready"));

  if (secureContext && !isStandalone()) {
    window.setTimeout(() => {
      if (!deferredPrompt && (isIOS || (isMac && isSafari))) showBanner("instructions");
    }, 1200);
  }

  window.__PWA_STATUS__ = Object.freeze({
    appName,
    secureContext,
    isSafari,
    isIOS,
    isMac,
    isFirefox,
    isStandalone
  });
})();
