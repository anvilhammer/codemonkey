// Path: src/webview/webviewTemplate.ts

export const getHtmlForWebview = (): string => {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
              /* CSS for chat container, messages, input area, etc. */
              body {
                  display: flex;
                  flex-direction: column;
                  height: 100vh;
                  margin: 0;
                  padding: 0;
                  font-family: var(--vscode-font-family);
                  background: var(--vscode-editor-background);
                  color: var(--vscode-editor-foreground);
              }
  
              #chat-container {
                  display: flex;
                  flex-direction: column;
                  height: 100%;
                  width: 100%;
                  padding: 10px;
                  gap: 10px;
                  box-sizing: border-box;
              }
  
              #messages {
                  flex: 1;
                  overflow-y: auto;
                  padding: 10px;
                  background: var(--vscode-input-background);
                  border: 1px solid var(--vscode-input-border);
                  border-radius: 4px;
              }
  
              .message {
                  margin: 8px 0;
                  padding: 12px 12px 12px 36px;
                  border-radius: 6px;
                  white-space: pre-wrap;
                  word-break: break-word;
                  font-size: 14px;
                  line-height: 1.4;
                  position: relative;
              }
  
              .message::before {
                  position: absolute;
                  left: 8px;
                  top: 12px;
                  font-size: 12px;
                  font-weight: 600;
                  opacity: 0.8;
              }
  
              .message.user {
                  background: var(--vscode-button-background);
                  color: var(--vscode-button-foreground);
                  margin-left: 20px;
                  border-left: 3px solid var(--vscode-button-hoverBackground);
              }
              .message.user::before { 
                  content: "👤";
              }
  
              .message.assistant {
                  background: var(--vscode-editor-selectionBackground);
                  color: rgba(255, 255, 255, 0.95);
                  margin-right: 20px;
                  border-left: 3px solid var(--vscode-editor-selectionHighlightBackground);
              }
              .message.assistant::before { 
                  content: "🤖";
              }
  
              /* Additional message types styling... */
  
              .timestamp {
                  font-size: 0.8em;
                  color: rgba(255, 255, 255, 0.7);
                  margin-top: 4px;
                  opacity: 0.9;
              }
  
              #input-area {
                  display: flex;
                  flex-direction: column;
                  gap: 10px;
                  min-height: 100px;
                  max-height: 200px;
              }
  
              textarea {
                  flex-grow: 1;
                  width: 100%;
                  resize: vertical;
                  padding: 8px;
                  background: var(--vscode-input-background);
                  color: var(--vscode-input-foreground);
                  border: 1px solid var(--vscode-input-border);
                  border-radius: 4px;
                  font-family: var(--vscode-font-family);
              }
  
              button {
                  padding: 8px;
                  background: var(--vscode-button-background);
                  color: var(--vscode-button-foreground);
                  border: none;
                  border-radius: 2px;
                  cursor: pointer;
              }
  
              button:hover {
                  background: var(--vscode-button-hoverBackground);
              }
          </style>
      </head>
      <body>
          <div id="chat-container">
              <div id="messages"></div>
              <div id="input-area">
                  <select id="model-select" onchange="changeModel()">
                      <option value="gpt3_5">GPT-3.5 Turbo - Affordable, well-rounded model (Cost: $0.0004/1K tokens)</option>
                      <option value="omini">OpenAI Mini - Cost-effective, lightweight model (Cost: $0.0008/1K tokens)</option>
                      <option value="haiku">Claude 3 Haiku - Fastest and most cost-effective (Cost: $0.00025/1K tokens)</option>
                      <option value="sonnet">Claude 3 Sonnet - Balanced performance (Cost: $0.0015/1K tokens)</option>
                      <option value="opus">Claude 3 Opus - Most capable (Cost: $0.015/1K tokens)</option>
                      <option value="gpt4o">GPT-4 Optimized - OpenAI's GPT-4 with optimized performance (Cost: $0.03/1K tokens)</option>
                  </select>
                  <textarea 
                      id="message-input" 
                      placeholder="Type your message here... (Shift+Enter for new line, Enter to send)"
                      rows="3"
                  ></textarea>
                  <button onclick="sendMessage()">Send Message</button>
              </div>
          </div>
  
          <script>
              const vscode = acquireVsCodeApi();
              const messagesContainer = document.getElementById('messages');
              const messageInput = document.getElementById('message-input');
  
              window.addEventListener('message', event => {
                  const message = event.data;
                  switch (message.type) {
                      case 'updateMessages':
                          updateMessages(message.messages);
                          break;
                  }
              });
  
              function updateMessages(messages) {
                  messagesContainer.innerHTML = '';
                  messages.forEach(msg => {
                      const messageDiv = document.createElement('div');
                      messageDiv.className = 'message ' + msg.type;
                      
                      const contentDiv = document.createElement('div');
                      contentDiv.textContent = msg.content;
                      messageDiv.appendChild(contentDiv);
  
                      const timestampDiv = document.createElement('div');
                      timestampDiv.className = 'timestamp';
                      timestampDiv.textContent = new Date(msg.timestamp).toLocaleTimeString();
                      messageDiv.appendChild(timestampDiv);
  
                      messagesContainer.appendChild(messageDiv);
                  });
  
                  messagesContainer.scrollTop = messagesContainer.scrollHeight;
              }
  
              function sendMessage() {
                  const message = messageInput.value.trim();
                  if (message) {
                      vscode.postMessage({
                          type: 'sendMessage',
                          message: message
                      });
                      messageInput.value = '';
                  }
              }
  
              function changeModel() {
                  const modelSelect = document.getElementById('model-select');
                  const selectedModel = modelSelect.value;
                  vscode.postMessage({
                      type: 'changeModel',
                      modelId: selectedModel
                  });
              }
  
              messageInput.addEventListener('keydown', (e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                  }
              });
          </script>
      </body>
      </html>
    `;
  };
