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

  if (!agentId) {
    console.error(
      "AgentDesk AI: data-agent-id is missing."
    );
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

  let visitorId =
    localStorage.getItem(
      "agentdesk_visitor_id"
    );

  if (!visitorId) {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      visitorId =
        crypto.randomUUID();
    } else {
      visitorId =
        "visitor-" +
        Date.now() +
        "-" +
        Math.random()
          .toString(36)
          .substring(2, 12);
    }

    localStorage.setItem(
      "agentdesk_visitor_id",
      visitorId
    );
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
          )}`
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
          data.agentName ||
          defaultSettings.agentName,

        welcomeMessage:
          data.welcomeMessage ||
          defaultSettings.welcomeMessage,

        primaryColor:
          data.primaryColor ||
          defaultSettings.primaryColor,
      };
    } catch (error) {
      console.error(
        "AgentDesk AI settings error:",
        error
      );

      return defaultSettings;
    }
  }

  // =========================================
  // Start Widget
  // =========================================

  async function startWidget() {
    const settings =
      await loadSettings();

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
        right: 24px;
        bottom: 24px;
        z-index: 2147483647;

        font-family:
          Arial,
          Helvetica,
          sans-serif;
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

      #agentdesk-ai-button svg {
        width: 28px;
        height: 28px;
        fill: currentColor;
      }

      #agentdesk-ai-window {
        position: absolute;

        right: 0;
        bottom: 76px;

        width: 370px;
        height: 520px;

        max-width:
          calc(100vw - 32px);

        max-height:
          calc(100vh - 120px);

        display: none;
        flex-direction: column;

        overflow: hidden;

        border-radius: 18px;

        background: #0f172a;
        color: white;

        border:
          1px solid #334155;

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

        background: #020617;
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
        background: #1e293b;

        color: #f8fafc;

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

        color: #94a3b8;

        font-size: 13px;
      }

      #agentdesk-ai-input-area {
        display: flex;

        gap: 8px;

        padding: 14px;

        border-top:
          1px solid #1e293b;

        background: #0f172a;
      }

      #agentdesk-ai-input {
        min-width: 0;

        flex: 1;

        border:
          1px solid #334155;

        border-radius: 10px;

        background: #020617;

        color: white;

        padding: 11px 12px;

        font-size: 14px;

        outline: none;
      }

      #agentdesk-ai-input::placeholder {
        color: #64748b;
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
          1px solid #1e293b;

        background: #0f172a;

        color: #64748b;

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
      "● Online";

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
      "Close chat"
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
      "Type your message...";

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
      "Send";

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
      "Open AI support chat"
    );

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
        "AI is typing...";

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

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  message: text,

                  agentId:
                    agentId,

                  visitorId:
                    visitorId,
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
            status.textContent =
              "● Offline";

            addAIMessage(
              "Our AI support agent is currently offline. Please try again later."
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
          "● Online";

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
          "Sorry, something went wrong. Please try again."
        );
      } finally {
        input.disabled =
          false;

        sendButton.disabled =
          false;

        sendButton.textContent =
          "Send";

        input.focus();
      }
    }

    // =========================================
    // Open Chat
    // =========================================

    chatButton.addEventListener(
      "click",
      function () {
        chatWindow.classList.toggle(
          "agentdesk-open"
        );

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
      }
    );

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