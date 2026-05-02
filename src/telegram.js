const TELEGRAM_API_URL = "https://api.telegram.org";

class TelegramClient {
  constructor(botToken) {
    this.botToken = botToken;
    this.baseUrl = `${TELEGRAM_API_URL}/bot${botToken}`;
  }

  async call(method, payload = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      const description = data.description || `Telegram API error on ${method}`;
      throw new Error(description);
    }

    return data.result;
  }

  getUpdates(offset, timeoutSeconds) {
    return this.call("getUpdates", {
      offset,
      timeout: timeoutSeconds
    });
  }

  sendMessage(chatId, text, options = {}) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      ...options
    });
  }
}

module.exports = {
  TelegramClient
};
