(function () {
  "use strict";

  // =========================================
  // Prevent Duplicate Widget
  // =========================================

  if (window.AgentDeskAIWidgetLoaded) {
    return;
  }

  window.AgentDeskAIWidgetLoaded = true;

  // =========================================
  // Current Script
  // =========================================

  const scripts =
    document.getElementsByTagName("script");

  const currentScript =
    document.currentScript ||
    scripts[scripts.length - 1];

  // =========================================
  // Agent ID
  // =========================================

  const agentId =
    currentScript?.getAttribute(
      "data-agent-id"
    ) || "";

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agentId)) {
    console.error(
      "AgentDesk AI: a valid data-agent-id is required."
    );
    window.AgentDeskAIWidgetLoaded = false;
    return;
  }

  // =========================================
  // AgentDesk Base URL
  // =========================================

  const scriptUrl =
    new URL(currentScript.src);

  const baseUrl =
    scriptUrl.origin;

  // =========================================
  // Visitor ID
  // =========================================

  const visitorStorageKey = `agentdesk_visitor_${agentId}`;
  const visitorIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let visitorId;
  try { visitorId = localStorage.getItem(visitorStorageKey); } catch { /* Storage can be disabled. */ }

  if (!visitorIdPattern.test(visitorId || "")) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      visitorId = crypto.randomUUID();
    } else if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      // Cryptographic UUIDs also work on HTTP pages where randomUUID is absent.
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      visitorId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } else {
      console.error("AgentDesk AI: secure visitor IDs are unavailable in this browser.");
      window.AgentDeskAIWidgetLoaded = false;
      return;
    }
    try { localStorage.setItem(visitorStorageKey, visitorId); } catch { /* Keep an in-memory visit. */ }
  }

  // =========================================
  // Default Settings
  // =========================================

  const defaultSettings = {
    agentName:
      "AI Support Assistant",

    welcomeMessage:
      "Hi! 👋 How can I help you today?",

    primaryColor:
      "#2563eb",

    isActive:
      true,
    position: "right",
    size: "standard",
    theme: "system",
    locale: "en",
  };

  // =========================================
  // Load Widget Settings
  // =========================================

  async function loadSettings() {
    try {
      const response =
        await fetch(
          `${baseUrl}/api/widget-settings?agentId=${encodeURIComponent(
            agentId
          )}`,
          {
            credentials: "omit",
            signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
              ? AbortSignal.timeout(10_000)
              : undefined,
          }
        );

      if (!response.ok) {
        throw new Error(
          "Could not load widget settings."
        );
      }

      const data =
        await response.json();

      return {
        agentName:
          (typeof data.agentName === "string" && data.agentName.slice(0, 100)) ||
          defaultSettings.agentName,

        welcomeMessage:
          (typeof data.welcomeMessage === "string" && data.welcomeMessage.slice(0, 1000)) ||
          defaultSettings.welcomeMessage,

        primaryColor:
          (typeof data.primaryColor === "string" && /^#[0-9a-f]{6}$/i.test(data.primaryColor) && data.primaryColor) ||
          defaultSettings.primaryColor,

        isActive:
          data.isActive !== false,
        position: ["left", "right"].includes(data.position) ? data.position : defaultSettings.position,
        size: ["compact", "standard", "large"].includes(data.size) ? data.size : defaultSettings.size,
        theme: ["light", "dark", "system"].includes(data.theme) ? data.theme : defaultSettings.theme,
        locale: ["en", "ps", "fa"].includes(data.locale) ? data.locale : defaultSettings.locale,
      };
    } catch (error) {
      console.error(
        "AgentDesk AI settings error:",
        error
      );

      window.AgentDeskAIWidgetLoaded = false;
      return null;
    }
  }

  // =========================================
  // Start Widget
  // =========================================

  async function startWidget() {
    const settings =
      await loadSettings();

    if (!settings) {
      return;
    }

    let agentIsActive =
      settings.isActive;

    const messagesByLocale = {
      en: {
        online: "Online",
        offline: "Offline",
        open: "Open AI support chat",
        close: "Close chat",
        input: "Type your message...",
        send: "Send",
        typing: "AI is typing...",
        unavailable: "The support agent is offline.",
        offlineReply: "Our AI support agent is currently offline. Please try again later.",
        error: "Sorry, something went wrong. Please try again.",
      },
      ps: {
        online: "آنلاین",
        offline: "آفلاین",
        open: "د AI مرستې خبرې پرانیزئ",
        close: "خبرې بندې کړئ",
        input: "خپل پیغام ولیکئ...",
        send: "ولېږئ",
        typing: "AI ځواب لیکي...",
        unavailable: "د مرستې استازی آفلاین دی.",
        offlineReply: "زموږ د AI مرستې استازی اوس آفلاین دی. وروسته بیا هڅه وکړئ.",
        error: "بښنه غواړو، ستونزه رامنځته شوه. بیا هڅه وکړئ.",
      },
      fa: {
        online: "آنلاین",
        offline: "آفلاین",
        open: "گفتگوی پشتیبانی هوش مصنوعی را باز کنید",
        close: "بستن گفتگو",
        input: "پیام خود را بنویسید...",
        send: "ارسال",
        typing: "هوش مصنوعی در حال نوشتن است...",
        unavailable: "دستیار پشتیبانی آفلاین است.",
        offlineReply: "دستیار پشتیبانی هوش مصنوعی اکنون آفلاین است. لطفاً بعداً دوباره تلاش کنید.",
        error: "متأسفیم، مشکلی رخ داد. لطفاً دوباره تلاش کنید.",
      },
    };
    const text = messagesByLocale[settings.locale] || messagesByLocale.en;
    const isRtl = settings.locale === "ps" || settings.locale === "fa";
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
    const useDarkTheme = settings.theme === "dark" || (settings.theme === "system" && prefersDark);
    const surface = useDarkTheme ? "#0f172a" : "#ffffff";
    const canvas = useDarkTheme ? "#020617" : "#f8fafc";
    const foreground = useDarkTheme ? "#f8fafc" : "#0f172a";
    const muted = useDarkTheme ? "#94a3b8" : "#475569";
    const border = useDarkTheme ? "#334155" : "#cbd5e1";

    // =========================================
    // CSS
    // =========================================

    const style =
      document.createElement("style");

    style.textContent = `
      #agentdesk-ai-root,
      #agentdesk-ai-root * {
        box-sizing: border-box;
      }

      #agentdesk-ai-root {
        position: fixed;
        ${settings.position === "left" ? "left" : "right"}: 24px;
        bottom: 24px;
        z-index: 2147483647;

        font-family:
          Arial,
          Helvetica,
          sans-serif;
        direction: ${isRtl ? "rtl" : "ltr"};
      }

      #agentdesk-ai-button {
        width: 60px;
        height: 60px;

        border: none;
        border-radius: 50%;

        background:
          ${settings.primaryColor};

        color: white;

        cursor: pointer;

        display: flex;
        align-items: center;
        justify-content: center;

        box-shadow:
          0 10px 30px
          rgba(0, 0, 0, 0.3);

        transition:
          transform 0.2s ease;
      }

      #agentdesk-ai-button:hover {
        transform: scale(1.06);
      }

      #agentdesk-ai-button:focus-visible,
      #agentdesk-ai-close:focus-visible,
      #agentdesk-ai-input:focus-visible,
      #agentdesk-ai-send:focus-visible {
        outline: 3px solid ${useDarkTheme ? "#ffffff" : "#0f172a"};
        outline-offset: 3px;
      }

      #agentdesk-ai-button svg {
        width: 28px;
        height: 28px;
        fill: currentColor;
      }

      #agentdesk-ai-window {
        position: absolute;

        right: 0;
        bottom: 76px;

        width: ${settings.size === "compact" ? "330px" : settings.size === "large" ? "420px" : "370px"};
        height: ${settings.size === "compact" ? "440px" : settings.size === "large" ? "620px" : "520px"};

        max-width:
          calc(100vw - 32px);

        max-height:
          calc(100vh - 120px);

        display: none;
        flex-direction: column;

        overflow: hidden;

        border-radius: 18px;

        background: ${surface};
        color: ${foreground};

        border:
          1px solid ${border};

        box-shadow:
          0 20px 60px
          rgba(0, 0, 0, 0.45);
      }

      #agentdesk-ai-window.agentdesk-open {
        display: flex;
      }

      #agentdesk-ai-header {
        background:
          ${settings.primaryColor};

        padding: 18px;

        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .agentdesk-header-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .agentdesk-avatar {
        width: 42px;
        height: 42px;

        display: flex;
        align-items: center;
        justify-content: center;

        border-radius: 50%;

        background:
          rgba(255, 255, 255, 0.2);

        color: white;

        font-weight: 700;
      }

      .agentdesk-agent-name {
        margin: 0;

        color: white;

        font-size: 15px;
        font-weight: 700;
      }

      .agentdesk-status {
        margin-top: 4px;

        color:
          rgba(255, 255, 255, 0.85);

        font-size: 12px;
      }

      #agentdesk-ai-close {
        border: none;

        background: transparent;

        color: white;

        font-size: 26px;

        line-height: 1;

        cursor: pointer;

        padding: 5px;
      }

      #agentdesk-ai-messages {
        flex: 1;

        overflow-y: auto;

        padding: 18px;

        background: ${canvas};
      }

      .agentdesk-message {
        max-width: 85%;

        padding: 12px 14px;

        border-radius: 15px;

        font-size: 14px;
        line-height: 1.5;

        word-wrap: break-word;

        white-space: pre-wrap;
      }

      .agentdesk-ai-message {
        background: ${useDarkTheme ? "#1e293b" : "#e2e8f0"};

        color: ${foreground};

        border-bottom-left-radius:
          5px;
      }

      .agentdesk-user-message {
        margin-left: auto;
        margin-top: 12px;

        background:
          ${settings.primaryColor};

        color: white;

        border-bottom-right-radius:
          5px;
      }

      .agentdesk-loading {
        margin-top: 12px;

        color: ${muted};

        font-size: 13px;
      }

      #agentdesk-ai-input-area {
        display: flex;

        gap: 8px;

        padding: 14px;

        border-top:
          1px solid ${border};

        background: ${surface};
      }

      #agentdesk-ai-input {
        min-width: 0;

        flex: 1;

        border:
          1px solid ${border};

        border-radius: 10px;

        background: ${canvas};

        color: ${foreground};

        padding: 11px 12px;

        font-size: 14px;

        outline: none;
      }

      #agentdesk-ai-input::placeholder {
        color: ${muted};
      }

      #agentdesk-ai-input:focus {
        border-color:
          ${settings.primaryColor};
      }

      #agentdesk-ai-send {
        border: none;

        border-radius: 10px;

        background:
          ${settings.primaryColor};

        color: white;

        padding: 0 16px;

        font-size: 13px;
        font-weight: 700;

        cursor: pointer;
      }

      #agentdesk-ai-send:disabled {
        opacity: 0.55;

        cursor: not-allowed;
      }

      .agentdesk-branding {
        padding: 7px;

        text-align: center;

        border-top:
          1px solid ${border};

        background: ${surface};

        color: ${muted};

        font-size: 10px;
      }

      @media (max-width: 500px) {
        #agentdesk-ai-root {
          right: 16px;
          bottom: 16px;
        }

        #agentdesk-ai-window {
          position: fixed;

          left: 12px;
          right: 12px;
          bottom: 88px;

          width: auto;

          height:
            min(
              520px,
              calc(100vh - 110px)
            );

          max-width: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #agentdesk-ai-root *,
        #agentdesk-ai-root *::before,
        #agentdesk-ai-root *::after {
          scroll-behavior: auto !important;
          transition: none !important;
          animation: none !important;
        }
      }
    `;

    document.head.appendChild(
      style
    );

    // =========================================
    // Root
    // =========================================

    const root =
      document.createElement("div");

    root.id =
      "agentdesk-ai-root";

    // =========================================
    // Chat Window
    // =========================================

    const chatWindow =
      document.createElement("div");

    chatWindow.id =
      "agentdesk-ai-window";
    chatWindow.setAttribute("role", "dialog");
    chatWindow.setAttribute("aria-modal", "false");
    chatWindow.setAttribute("aria-label", settings.agentName);
    chatWindow.setAttribute("aria-hidden", "true");
    chatWindow.dir = isRtl ? "rtl" : "ltr";

    // =========================================
    // Header
    // =========================================

    const header =
      document.createElement("div");

    header.id =
      "agentdesk-ai-header";

    const headerLeft =
      document.createElement("div");

    headerLeft.className =
      "agentdesk-header-left";

    const avatar =
      document.createElement("div");

    avatar.className =
      "agentdesk-avatar";

    avatar.textContent =
      "AI";

    const agentInfo =
      document.createElement("div");

    const agentName =
      document.createElement("p");

    agentName.className =
      "agentdesk-agent-name";

    agentName.textContent =
      settings.agentName;

    const status =
      document.createElement("div");

    status.className =
      "agentdesk-status";

    status.textContent =
      agentIsActive
        ? `● ${text.online}`
        : `● ${text.offline}`;

    agentInfo.appendChild(
      agentName
    );

    agentInfo.appendChild(
      status
    );

    headerLeft.appendChild(
      avatar
    );

    headerLeft.appendChild(
      agentInfo
    );

    const closeButton =
      document.createElement(
        "button"
      );

    closeButton.id =
      "agentdesk-ai-close";

    closeButton.type =
      "button";

    closeButton.setAttribute(
      "aria-label",
      text.close
    );

    closeButton.textContent =
      "×";

    header.appendChild(
      headerLeft
    );

    header.appendChild(
      closeButton
    );

    // =========================================
    // Messages
    // =========================================

    const messages =
      document.createElement("div");

    messages.id =
      "agentdesk-ai-messages";
    messages.setAttribute("role", "log");
    messages.setAttribute("aria-live", "polite");
    messages.setAttribute("aria-relevant", "additions text");

    const welcome =
      document.createElement("div");

    welcome.className =
      "agentdesk-message agentdesk-ai-message";

    welcome.textContent =
      settings.welcomeMessage;

    messages.appendChild(
      welcome
    );

    // =========================================
    // Input Area
    // =========================================

    const inputArea =
      document.createElement("div");

    inputArea.id =
      "agentdesk-ai-input-area";

    const input =
      document.createElement("input");

    input.id =
      "agentdesk-ai-input";

    input.type =
      "text";

    input.placeholder =
      text.input;

    input.autocomplete =
      "off";

    const sendButton =
      document.createElement(
        "button"
      );

    sendButton.id =
      "agentdesk-ai-send";

    sendButton.type =
      "button";

    sendButton.textContent =
      text.send;

    if (!agentIsActive) {
      input.disabled = true;
      sendButton.disabled = true;
      input.placeholder =
        text.unavailable;
    }

    inputArea.appendChild(
      input
    );

    inputArea.appendChild(
      sendButton
    );

    // =========================================
    // Branding
    // =========================================

    const branding =
      document.createElement("div");

    branding.className =
      "agentdesk-branding";

    branding.textContent =
      "Powered by AgentDesk AI";

    // =========================================
    // Build Chat
    // =========================================

    chatWindow.appendChild(
      header
    );

    chatWindow.appendChild(
      messages
    );

    chatWindow.appendChild(
      inputArea
    );

    chatWindow.appendChild(
      branding
    );

    // =========================================
    // Floating Button
    // =========================================

    const chatButton =
      document.createElement(
        "button"
      );

    chatButton.id =
      "agentdesk-ai-button";

    chatButton.type =
      "button";

    chatButton.setAttribute(
      "aria-label",
      text.open
    );
    chatButton.setAttribute("aria-controls", "agentdesk-ai-window");
    chatButton.setAttribute("aria-expanded", "false");

    chatButton.innerHTML = `
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          d="M4 4h16c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H8l-4 4v-4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zm2 5h12V7H6v2zm0 4h9v-2H6v2z"
        />
      </svg>
    `;

    root.appendChild(
      chatWindow
    );

    root.appendChild(
      chatButton
    );

    // =========================================
    // Mount Widget
    // =========================================

    function mountWidget() {
      if (!document.body) {
        return;
      }

      document.body.appendChild(
        root
      );
    }

    if (
      document.readyState ===
      "loading"
    ) {
      document.addEventListener(
        "DOMContentLoaded",
        mountWidget
      );
    } else {
      mountWidget();
    }

    // =========================================
    // Helpers
    // =========================================

    function scrollBottom() {
      messages.scrollTop =
        messages.scrollHeight;
    }

    function addUserMessage(
      text
    ) {
      const element =
        document.createElement(
          "div"
        );

      element.className =
        "agentdesk-message agentdesk-user-message";

      element.textContent =
        text;

      messages.appendChild(
        element
      );

      scrollBottom();
    }

    function addAIMessage(
      text
    ) {
      const element =
        document.createElement(
          "div"
        );

      element.className =
        "agentdesk-message agentdesk-ai-message";

      element.style.marginTop =
        "12px";

      element.textContent =
        text;

      messages.appendChild(
        element
      );

      scrollBottom();
    }

    // =========================================
    // Send Message
    // =========================================

    async function sendMessage() {
      const text =
        input.value.trim();

      if (
        !text ||
        sendButton.disabled
      ) {
        return;
      }

      addUserMessage(text);

      input.value = "";

      input.disabled = true;

      sendButton.disabled =
        true;

      sendButton.textContent =
        "...";

      const loading =
        document.createElement(
          "div"
        );

      loading.className =
        "agentdesk-loading";

      loading.textContent =
        text.typing;

      messages.appendChild(
        loading
      );

      scrollBottom();

      try {
        const response =
          await fetch(
            `${baseUrl}/api/chat`,
            {
              method: "POST",
              credentials: "omit",

              headers: {
                "Content-Type":
                  "application/json",
              },

              signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
                ? AbortSignal.timeout(45_000)
                : undefined,

              body:
                JSON.stringify({
                  message: text,

                  agentId:
                    agentId,

                  visitorId:
                    visitorId,

                  requestId:
                    crypto.randomUUID(),
                }),
            }
          );

        const data =
          await response.json();

        loading.remove();

        // =====================================
        // Agent Offline
        // =====================================

        if (!response.ok) {
          if (data.offline === true) {
            agentIsActive = false;

            status.textContent =
              `● ${text.offline}`;

            addAIMessage(
              text.offlineReply
            );

            return;
          }

          throw new Error(
            data.error ||
              "AI request failed."
          );
        }

        // =====================================
        // Agent Online
        // =====================================

        status.textContent =
          `● ${text.online}`;

        agentIsActive = true;

        addAIMessage(
          data.reply ||
            "Sorry, I could not generate a response."
        );
      } catch (error) {
        console.error(
          "AgentDesk AI request error:",
          error
        );

        if (loading.isConnected) {
          loading.remove();
        }

        addAIMessage(
          text.error
        );
      } finally {
        input.disabled =
          !agentIsActive;

        sendButton.disabled =
          !agentIsActive;

        sendButton.textContent =
          text.send;

        input.placeholder = agentIsActive
          ? text.input
          : text.unavailable;

        if (agentIsActive) {
          input.focus();
        }
      }
    }

    // =========================================
    // Open Chat
    // =========================================

    chatButton.addEventListener(
      "click",
      function () {
        const opening = !chatWindow.classList.contains("agentdesk-open");
        chatWindow.classList.toggle("agentdesk-open", opening);
        chatWindow.setAttribute("aria-hidden", String(!opening));
        chatButton.setAttribute("aria-expanded", String(opening));

        if (
          chatWindow.classList.contains(
            "agentdesk-open"
          )
        ) {
          setTimeout(
            () => input.focus(),
            100
          );
        }
      }
    );

    // =========================================
    // Close Chat
    // =========================================

    closeButton.addEventListener(
      "click",
      function () {
        chatWindow.classList.remove(
          "agentdesk-open"
        );
        chatWindow.setAttribute("aria-hidden", "true");
        chatButton.setAttribute("aria-expanded", "false");
        chatButton.focus();
      }
    );

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && chatWindow.classList.contains("agentdesk-open")) {
        closeButton.click();
      }
    });

    // =========================================
    // Send Button
    // =========================================

    sendButton.addEventListener(
      "click",
      sendMessage
    );

    // =========================================
    // Enter Key
    // =========================================

    input.addEventListener(
      "keydown",
      function (event) {
        if (
          event.key === "Enter"
        ) {
          event.preventDefault();

          sendMessage();
        }
      }
    );
  }

  // =========================================
  // Run Widget
  // =========================================

  startWidget();
})();
