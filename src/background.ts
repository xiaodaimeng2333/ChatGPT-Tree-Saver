function saveRequestHeaders(headers: chrome.webRequest.HttpHeader[]) {
  chrome.storage.session.set({ storedRequestHeaders: headers }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error saving headers:', chrome.runtime.lastError);
    }
  });
}

function loadRequestHeaders(): Promise<chrome.webRequest.HttpHeader[] | null> {
  return new Promise((resolve) => {
    chrome.storage.session.get(['storedRequestHeaders'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading headers:', chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(result.storedRequestHeaders || null);
      }
    });
  });
}

function captureHeaders() {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (details.requestHeaders?.some(h => h.name.toLowerCase() === 'authorization')) {
        saveRequestHeaders(details.requestHeaders);
      }
    },
    { urls: ["https://chatgpt.com/backend-api/*"] },
    ["requestHeaders"]
  );

  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      if (details.requestHeaders?.some(h => h.name.toLowerCase() === 'authorization')) {
        saveRequestHeaders(details.requestHeaders);
      }
    },
    { urls: ["https://chatgpt.com/backend-api/*"] },
    ["requestHeaders"]
  );
}

chrome.runtime.onMessage.addListener(
  (request, _sender, sendResponse) => {
    if (request.action === "getHeaders") {
      loadRequestHeaders().then(headers => {
        sendResponse({ headers });
      });
      return true;
    } 
    else if (request.action === "fetchConversationHistory") {
      fetchConversationHistory()
        .then(data => {
          sendResponse({ success: true, data });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
    else if (request.action === "checkNodes") {
      checkNodesExistence(request.nodeIds)
        .then(existingNodes => {
          sendResponse({ success: true, existingNodes });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // Important for async response
    }
    else if (request.action === "editMessage") {
      (async () => {
        try {
          await editMessage(request.messageId, request.message);
          sendResponse({ success: true, completed: true });
        } catch (error: any) {
          sendResponse({ 
            success: false, 
            completed: false, 
            error: error.message 
          });
        }
      })();
      return true; // Keep message channel open for async response
    }
    else if (request.action === "respondToMessage") {
      (async () => {
        try {
          await respondToMessage(request.childrenIds, request.message);
          sendResponse({ success: true, completed: true });
        } catch (error: any) {
          sendResponse({ 
            success: false, 
            completed: false, 
            error: error.message 
          });
        }
      })();
      return true; // Keep message channel open for async response
    } else if (request.action === "executeSteps") {
      (async () => {
        try {
          await selectBranch(request.steps);
          sendResponse({ success: true, completed: true });
        } catch (error: any) {
          sendResponse({ 
            success: false, 
            completed: false, 
            error: error.message 
          });
        }
      })();
      return true; // Keep message channel open for async response
    } else if (request.action === "selectBranch") {
      (async () => {
        try {
          const result = await selectBranch(request.steps);
          sendResponse({ success: true, result });
        } catch (error: any) {
          sendResponse({ 
            success: false, 
            error: error.message 
          });
        }
      })();
      return true; // Keep message channel open for async response
    } else if (request.action === "goToTarget") {
      goToTarget(request.targetId);
      sendResponse({ success: true });
      return true;
    } else if (request.action === "log") {
      console.log(request.message);
      sendResponse({ success: true });
      return true;
    }
    return false; // For non-async handlers
  }
);

async function fetchConversationHistory() {
  let headers = null;
  for (let i = 0; i < 3; i++) {
    headers = await loadRequestHeaders();
    if (headers?.some(h => h.name.toLowerCase() === 'authorization')) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (!headers?.some(h => h.name.toLowerCase() === 'authorization')) {
    console.error('No authorization header available');
    throw new Error('Authorization header not found');
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    if (!currentTab?.url) {
      console.log('No active tab URL found');
      return null;
    }
    
    const url = new URL(currentTab.url);
    const pathParts = url.pathname.split('/');
    
    let conversationId = '';
    
    if (url.pathname.includes('/c/')) {
      conversationId = pathParts[pathParts.indexOf('c') + 1];
    } else if (url.pathname.includes('/g/')) {
      conversationId = pathParts[pathParts.indexOf('g') + 1];
    } else {
      throw new Error('Unsupported conversation URL format');
    }
    
    if (!conversationId) {
      throw new Error('Could not extract conversation ID from URL');
    }

    const headersList = new Headers();
    headers.forEach(header => {
      headersList.append(header.name, header.value || '');
    });

    const response = await fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`, {
      method: 'GET',
      headers: headersList,
    });
    
    const data = await response.json();
    if (!data) {
      throw new Error('No data received');
    }
    return data;
  } catch (error) {
    console.error('Error in fetchConversationHistory:', error);
    throw error;
  }
}

async function checkNodesExistence(nodeIds: string[]) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id ?? 0 },
      func: (ids) => {
        return ids.map(id => document.querySelector(`[data-message-id="${id}"]`) === null);
      },
      args: [nodeIds]  // Pass nodeIds as an argument to the injected function
    });
    
    return results[0].result;  // Returns array of nodeIds that exist in the DOM
  } catch (error) {
    console.error('Error in checkNodesExistence:', error);
    throw error;
  }
}

async function editMessage(messageId: string, message: string) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  await chrome.scripting.executeScript({
    target: { tabId: currentTab.id ?? 0 },
    func: (messageId, message) => {
      const waitForDomChange = (element: Element, timeout = 2000): Promise<void> => {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Timeout waiting for DOM changes'));
          }, timeout);

          const observer = new MutationObserver((mutations) => {
            if (mutations.length > 0) {
              clearTimeout(timeoutId);
              observer.disconnect();
              setTimeout(resolve, 50);
            }
          });

          observer.observe(element, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
          });
        });
      };

      const performEdit = async () => {
        const element = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!element) throw new Error('Message element not found');

        const buttonDiv = element.parentElement?.parentElement;
        if (!buttonDiv) throw new Error('Button container not found');

        const buttons = buttonDiv.querySelectorAll("button");
        const editButton = Array.from(buttons).find(button => {
          const ariaLabel = button.getAttribute('aria-label');
          return ariaLabel === "Edit message" || ariaLabel === "编辑消息";
        });
        if (!editButton) throw new Error('Edit button not found');
        
        editButton.click();
        await waitForDomChange(buttonDiv);

        let textArea = buttonDiv.querySelector("textarea");
        let attempts = 0;
        const maxAttempts = 5;
        
        while (!textArea && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          textArea = buttonDiv.querySelector("textarea");
          attempts++;
        }
        
        if (!textArea) throw new Error('Textarea not found after multiple attempts');
        
        textArea.value = message;
        textArea.dispatchEvent(new Event('input', { bubbles: true }));
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        let currentElement: Element | null = textArea;
        let sendButton: HTMLButtonElement | null = null;
        let iterations = 0;
        
        while (currentElement && iterations < 10) {
          const buttons = currentElement.querySelectorAll('button');
          sendButton = Array.from(buttons).find(
            button => {
              const text = button.textContent?.trim();
              return text === 'Send' || text === '发送';
            }
          ) as HTMLButtonElement || null;
          if (sendButton) break;
          
          currentElement = currentElement.parentElement;
          iterations++;
        }

        if (!sendButton) throw new Error('Send button not found');
        sendButton.click();
        
        await waitForDomChange(buttonDiv, 2000);
      };

      return performEdit().catch(error => {
        console.error('Error in editMessage:', error);
        throw error;
      });
    },
    args: [messageId, message]
  });
}


async function respondToMessage(childrenIds: string[], message: string) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  await chrome.scripting.executeScript({
    target: { tabId: currentTab.id ?? 0 },
    func: (childrenIds, message: string) => {
      const waitForDomChange = (element: Element, timeout = 2000): Promise<void> => {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Timeout waiting for DOM changes'));
          }, timeout);

          const observer = new MutationObserver((mutations) => {
            if (mutations.length > 0) {
              clearTimeout(timeoutId);
              observer.disconnect();
              setTimeout(resolve, 50);
            }
          });

          observer.observe(element, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
          });
        });
      };

      const performResponse = async () => {
        let element = null;
        for (const messageId of childrenIds) {
          element = document.querySelector(`[data-message-id="${messageId}"]`);
          if (element) break;
        }
        if (!element) throw new Error('No visible message element found');

        const buttonDiv = element.parentElement?.parentElement;
        if (!buttonDiv) throw new Error('Button container not found');

        const buttons = buttonDiv.querySelectorAll("button");
        const editButton = Array.from(buttons).find(button => {
          const ariaLabel = button.getAttribute('aria-label');
          return ariaLabel === "Edit message" || ariaLabel === "编辑消息";
        });
        if (!editButton) throw new Error('Edit button not found');

        editButton.click();
        await waitForDomChange(buttonDiv);

        let textArea = buttonDiv.querySelector("textarea");
        let attempts = 0;
        const maxAttempts = 5;
        
        while (!textArea && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          textArea = buttonDiv.querySelector("textarea");
          attempts++;
        }
        
        if (!textArea) throw new Error('Textarea not found after multiple attempts');
        
        textArea.value = message;
        textArea.dispatchEvent(new Event('input', { bubbles: true }));
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        let currentElement: Element | null = textArea;
        let sendButton: HTMLButtonElement | null = null;
        let iterations = 0;

        while (currentElement && iterations < 10) {
          const buttons = currentElement.querySelectorAll('button');
          sendButton = Array.from(buttons).find(
            button => {
              const text = button.textContent?.trim();
              return text === 'Send' || text === '发送';
            }
          ) as HTMLButtonElement || null;
          if (sendButton) break;

          currentElement = currentElement.parentElement;
          iterations++;
        }

        if (!sendButton) throw new Error('Send button not found');
        sendButton.click();

        await waitForDomChange(buttonDiv, 2000);
      };

      return performResponse().catch(error => {
        console.error('Error in respondToMessage:', error);
        throw error;
      });
    },
    args: [childrenIds, message]
  });
}

async function selectBranch(stepsToTake: any[]) {
  console.log('【导航后台】===== selectBranch 开始执行 =====');
  console.log('【导航后台】步骤数量:', stepsToTake.length);
  console.log('【导航后台】步骤详情:', JSON.stringify(stepsToTake, null, 2));
  
  try {
    if (!Array.isArray(stepsToTake) || stepsToTake.length === 0) {
      console.error('【导航后台】❌ 无效的步骤数组');
      throw new Error('无效的步骤数组');
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('【导航后台】当前活动标签页:', tabs.length > 0 ? tabs[0].url : '无');
    
    if (!tabs || tabs.length === 0) {
      console.error('【导航后台】❌ 未找到活动标签页');
      throw new Error('未找到活动标签页');
    }
    const currentTab = tabs[0];
    if (!currentTab.id) {
      console.error('【导航后台】❌ 当前标签页没有ID');
      throw new Error('当前标签页没有ID');
    }

    console.log('【导航后台】开始执行导航脚本');
    const result = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: async (stepsToTake) => {
        console.log('【导航页面】===== 页面导航脚本开始执行 =====');
        console.log('【导航页面】步骤数量:', stepsToTake.length);
        
        // 等待DOM变化的函数
        const waitForDomChange = (timeout = 300): Promise<boolean> => {
          return new Promise((resolve) => {
            console.log('【导航页面】开始观察DOM变化');
            // 转发日志到后台
            chrome.runtime.sendMessage({ action: "log", message: '【导航页面】开始观察DOM变化' });
            
            // 获取主要内容区域
            const mainContent = document.querySelector('main') || document.body;
            
            const timeoutId = setTimeout(() => {
              observer.disconnect();
              console.log('【导航页面】⚠️ 等待DOM变化超时');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】⚠️ 等待DOM变化超时' });
              resolve(false);
            }, timeout);

            const observer = new MutationObserver((mutations) => {
              if (mutations.length > 0) {
                clearTimeout(timeoutId);
                observer.disconnect();
                console.log('【导航页面】✓ 检测到DOM变化，变化数量:', mutations.length);
                chrome.runtime.sendMessage({ action: "log", message: `【导航页面】✓ 检测到DOM变化，变化数量: ${mutations.length}` });
                setTimeout(() => resolve(true), 10); // 减少等待时间
              }
            });

            observer.observe(mainContent, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });
          });
        };

        // 强力触发按钮显示的函数
        const triggerButtonsDisplay = (element: Element): Promise<boolean> => {
          return new Promise((resolve) => {
            console.log('【按钮刷新】===== 开始强力触发按钮显示 =====');
            chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】===== 开始强力触发按钮显示 =====' });
            
            console.log('【按钮刷新】目标元素ID:', element.getAttribute('data-message-id'));
            chrome.runtime.sendMessage({ action: "log", message: `【按钮刷新】目标元素ID: ${element.getAttribute('data-message-id')}` });
            
            const messageGroup = element.closest('.group\\/conversation-turn');
            if (!messageGroup) {
              console.log('【按钮刷新】❌ 未找到消息组容器，无法触发按钮显示');
              chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】❌ 未找到消息组容器，无法触发按钮显示' });
              resolve(false);
              return;
            }
            
            console.log('【按钮刷新】✓ 找到消息组容器');
            chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】✓ 找到消息组容器' });
            
            // 记录初始按钮状态
            const buttonContainer = messageGroup.querySelector('.mb-2.flex.gap-3, .flex.gap-3, .message-actions');
            const initialButtonCount = buttonContainer?.querySelectorAll('button').length || 0;
            console.log('【按钮刷新】初始按钮数量:', initialButtonCount);
            chrome.runtime.sendMessage({ action: "log", message: `【按钮刷新】初始按钮数量: ${initialButtonCount}` });
            
            // 如果已经有按钮，直接返回成功
            if (initialButtonCount >= 2) {
              console.log('【按钮刷新】已有足够按钮，无需触发');
              chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】已有足够按钮，无需触发' });
              resolve(true);
              return;
            }
            
            const messageContent = messageGroup.querySelector('.min-h-8.text-message, .text-message, .markdown');
            const messageAuthorRole = messageContent?.getAttribute('data-message-author-role');
            console.log('【按钮刷新】消息作者角色:', messageAuthorRole);
            chrome.runtime.sendMessage({ action: "log", message: `【按钮刷新】消息作者角色: ${messageAuthorRole}` });
            
            const messageElement = messageGroup.querySelector('[data-message-id]');
            if (messageElement) {
              console.log('【按钮刷新】✓ 找到消息元素，开始触发事件');
              chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】✓ 找到消息元素，开始触发事件' });
              
              // 强力触发方法1: 多种事件类型
              const events = [
                new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }),
                new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }),
                new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }),
                new FocusEvent('focus', { bubbles: true, cancelable: true }),
                new MouseEvent('pointerover', { bubbles: true, cancelable: true, view: window }),
                new MouseEvent('pointerenter', { bubbles: true, cancelable: true, view: window })
              ];
              
              // 强力触发方法2: 对消息组的所有可能元素触发事件
              console.log('【按钮刷新】触发消息组事件');
              chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】触发消息组事件' });
              events.forEach(event => {
                messageGroup.dispatchEvent(event);
              });
              
              console.log('【按钮刷新】触发消息元素事件');
              chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】触发消息元素事件' });
              events.forEach(event => {
                messageElement.dispatchEvent(event);
              });
              
              // 强力触发方法3: 对所有父元素触发事件
              const parentElements = [
                messageElement.parentElement,
                messageElement.parentElement?.parentElement,
                messageElement.parentElement?.parentElement?.parentElement,
                messageElement.parentElement?.parentElement?.parentElement?.parentElement
              ];
              
              console.log('【按钮刷新】触发父元素事件');
              chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】触发父元素事件' });
              parentElements.forEach(parent => {
                if (parent) {
                  events.forEach(event => {
                    parent.dispatchEvent(event);
                  });
                }
              });
              
              // 强力触发方法4: 对消息内容触发事件
              if (messageContent) {
                console.log('【按钮刷新】触发消息内容区域事件');
                chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】触发消息内容区域事件' });
                events.forEach(event => {
                  messageContent.dispatchEvent(event);
                });
              }
              
              // 强力触发方法5: 对消息操作区域触发事件
              const messageActions = messageGroup.querySelector('.message-actions, .message-header, .flex.gap-3');
              if (messageActions) {
                console.log('【按钮刷新】触发消息操作区域事件');
                chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】触发消息操作区域事件' });
                events.forEach(event => {
                  messageActions.dispatchEvent(event);
                });
              }
              
              // 强力触发方法6: 尝试点击消息元素
              try {
                console.log('【按钮刷新】尝试点击消息元素');
                chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】尝试点击消息元素' });
                (messageElement as HTMLElement).click();
              } catch (e) {
                console.log('【按钮刷新】点击消息元素失败:', e);
                chrome.runtime.sendMessage({ action: "log", message: `【按钮刷新】点击消息元素失败: ${e}` });
              }
              
              // 检查按钮是否显示出来
              setTimeout(() => {
                // 检查多个可能的按钮容器选择器
                const selectors = [
                  '.mb-2.flex.gap-3', 
                  '.flex.gap-3', 
                  '.message-actions button',
                  '.message-header button',
                  '.flex.items-center button'
                ];
                
                let updatedButtonCount = 0;
                
                for (const selector of selectors) {
                  const container = messageGroup.querySelector(selector);
                  if (container) {
                    const buttons = container.querySelectorAll('button');
                    if (buttons.length > updatedButtonCount) {
                      updatedButtonCount = buttons.length;
                    }
                  }
                }
                
                console.log('【按钮刷新】触发后按钮数量:', updatedButtonCount);
                chrome.runtime.sendMessage({ action: "log", message: `【按钮刷新】触发后按钮数量: ${updatedButtonCount}` });
                
                const success = updatedButtonCount > initialButtonCount;
                console.log('【按钮刷新】按钮显示触发' + (success ? '✓ 成功' : '❌ 失败'));
                chrome.runtime.sendMessage({ action: "log", message: `【按钮刷新】按钮显示触发${success ? '✓ 成功' : '❌ 失败'}` });
                
                resolve(success);
              }, 10); // 减少等待时间
            } else {
              console.log('【按钮刷新】❌ 未找到消息元素，无法触发按钮显示');
              chrome.runtime.sendMessage({ action: "log", message: '【按钮刷新】❌ 未找到消息元素，无法触发按钮显示' });
              resolve(false);
            }
          });
        };

        // 查找目标按钮的函数
        const findNavigationButton = (buttonDiv: Element, isLeftDirection: boolean): HTMLElement | null => {
          console.log('【导航页面】开始查找目标按钮，方向:', isLeftDirection ? '左' : '右');
          chrome.runtime.sendMessage({ action: "log", message: `【导航页面】开始查找目标按钮，方向: ${isLeftDirection ? '左' : '右'}` });
          
          const currentButtons = buttonDiv.querySelectorAll("button");
          console.log('【导航页面】当前按钮数量:', currentButtons.length);
          chrome.runtime.sendMessage({ action: "log", message: `【导航页面】当前按钮数量: ${currentButtons.length}` });
          
          if (!currentButtons || currentButtons.length < 2) {
            console.log('【导航页面】⚠️ 按钮数量不足，可能无法完成导航');
            chrome.runtime.sendMessage({ action: "log", message: '【导航页面】⚠️ 按钮数量不足，可能无法完成导航' });
            return null;
          }
          
          // 方法1: 通过aria-label查找
          const buttonByAriaLabel = Array.from(currentButtons).find((button: Element) => {
            const ariaLabel = button.getAttribute('aria-label');
            return isLeftDirection ? 
              (ariaLabel === "Previous response" || ariaLabel === "上一回复") :
              (ariaLabel === "Next response" || ariaLabel === "下一回复");
          }) as HTMLElement | null;
          
          if (buttonByAriaLabel) {
            console.log('【导航页面】✓ 通过aria-label找到按钮');
            chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 通过aria-label找到按钮' });
            return buttonByAriaLabel;
          }
          
          // 方法2: 通过SVG路径查找
          console.log('【导航页面】通过aria-label未找到按钮，尝试通过SVG路径查找');
          chrome.runtime.sendMessage({ action: "log", message: '【导航页面】通过aria-label未找到按钮，尝试通过SVG路径查找' });
          
          for (let i = 0; i < currentButtons.length; i++) {
            const button = currentButtons[i] as HTMLElement;
            const svg = button.querySelector('svg');
            if (svg) {
              const path = svg.querySelector('path');
              if (path) {
                const d = path.getAttribute('d');
                const isLeftArrow = d && d.includes('14.7071 5.29289') && d.includes('7.29289 11.2929');
                const isRightArrow = d && d.includes('9.29289 18.7071') && d.includes('16.7071 11.2929');
                
                if ((isLeftDirection && isLeftArrow) || (!isLeftDirection && isRightArrow)) {
                  console.log('【导航页面】✓ 通过SVG路径找到按钮');
                  chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 通过SVG路径找到按钮' });
                  return button;
                }
              }
            }
          }
          
          // 方法3: 通过位置猜测
          console.log('【导航页面】通过SVG路径未找到按钮，尝试通过位置猜测');
          chrome.runtime.sendMessage({ action: "log", message: '【导航页面】通过SVG路径未找到按钮，尝试通过位置猜测' });
          if (currentButtons.length >= 2) {
            const index = isLeftDirection ? 0 : Math.min(2, currentButtons.length - 1);
            console.log('【导航页面】✓ 通过位置猜测找到按钮，索引:', index);
            chrome.runtime.sendMessage({ action: "log", message: `【导航页面】✓ 通过位置猜测找到按钮，索引: ${index}` });
            return currentButtons[index] as HTMLElement;
          }
          
          console.log('【导航页面】❌ 所有方法都未找到按钮');
          chrome.runtime.sendMessage({ action: "log", message: '【导航页面】❌ 所有方法都未找到按钮' });
          return null;
        };

        // 处理所有导航步骤
        const processAllSteps = async () => {
          try {
            console.log('【导航页面】开始处理所有导航步骤');
            chrome.runtime.sendMessage({ action: "log", message: '【导航页面】开始处理所有导航步骤' });
            
            // 记录初始URL
            const initialUrl = window.location.href;
            console.log('【导航页面】初始URL:', initialUrl);
            chrome.runtime.sendMessage({ action: "log", message: `【导航页面】初始URL: ${initialUrl}` });
            
            // 记录最后一个步骤的ID，用于验证导航是否成功
            const finalStepId = stepsToTake[stepsToTake.length - 1]?.nodeId;
            console.log('【导航页面】最终目标节点ID:', finalStepId);
            chrome.runtime.sendMessage({ action: "log", message: `【导航页面】最终目标节点ID: ${finalStepId}` });
            
            for (let stepIndex = 0; stepIndex < stepsToTake.length; stepIndex++) {
              const step = stepsToTake[stepIndex];
              console.log(`【导航页面】处理步骤 ${stepIndex + 1}/${stepsToTake.length}:`, JSON.stringify(step));
              chrome.runtime.sendMessage({ action: "log", message: `【导航页面】处理步骤 ${stepIndex + 1}/${stepsToTake.length}: ${JSON.stringify(step)}` });
              
              if (!step.nodeId) {
                console.error('【导航页面】❌ 步骤缺少nodeId');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】❌ 步骤缺少nodeId' });
                throw new Error('步骤缺少nodeId');
              }

              // 查找目标元素
              console.log('【导航页面】查找节点元素，ID:', step.nodeId);
              chrome.runtime.sendMessage({ action: "log", message: `【导航页面】查找节点元素，ID: ${step.nodeId}` });
              const element = document.querySelector(`[data-message-id="${step.nodeId}"]`);
              if (!element) {
                console.error('【导航页面】❌ 未找到节点元素，ID:', step.nodeId);
                chrome.runtime.sendMessage({ action: "log", message: `【导航页面】❌ 未找到节点元素，ID: ${step.nodeId}` });
                throw new Error(`未找到节点元素: ${step.nodeId}`);
              }
              console.log('【导航页面】✓ 找到节点元素');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 找到节点元素' });
              
              // 查找按钮容器
              const buttonDiv = element.parentElement?.parentElement || null;
              if (!buttonDiv) {
                console.error('【导航页面】❌ 未找到按钮容器');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】❌ 未找到按钮容器' });
                throw new Error('未找到按钮容器');
              }
              console.log('【导航页面】✓ 找到按钮容器');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 找到按钮容器' });
              
              // 强制触发按钮显示
              console.log('【导航页面】开始强制触发按钮显示');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】开始强制触发按钮显示' });
              let buttonDisplaySuccess = false;
              for (let attempt = 1; attempt <= 2; attempt++) { // 减少尝试次数
                console.log(`【导航页面】尝试触发按钮显示 (尝试 ${attempt}/2)`);
                chrome.runtime.sendMessage({ action: "log", message: `【导航页面】尝试触发按钮显示 (尝试 ${attempt}/2)` });
                buttonDisplaySuccess = await triggerButtonsDisplay(element);
                if (buttonDisplaySuccess) {
                  console.log('【导航页面】✓ 按钮显示触发成功');
                  chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 按钮显示触发成功' });
                  break;
                }
                
                if (attempt < 2) {
                  console.log('【导航页面】❌ 按钮显示触发失败，等待后重试');
                  chrome.runtime.sendMessage({ action: "log", message: '【导航页面】❌ 按钮显示触发失败，等待后重试' });
                  await new Promise(resolve => setTimeout(resolve, 10)); // 减少等待时间
                }
              }
              
              if (!buttonDisplaySuccess) {
                console.log('【导航页面】⚠️ 多次尝试后仍未能触发按钮显示，尝试继续执行');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】⚠️ 多次尝试后仍未能触发按钮显示，尝试继续执行' });
              }
              
              // 查找目标按钮
              const targetButton = findNavigationButton(buttonDiv, step.stepsLeft > 0);
              
              if (!targetButton) {
                console.error('【导航页面】❌ 未找到所需的按钮');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】❌ 未找到所需的按钮' });
                throw new Error('未找到所需的按钮');
              }
              
              console.log('【导航页面】✓ 找到所需按钮，准备点击');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 找到所需按钮，准备点击' });
              
              // 点击按钮
              try {
                console.log('【导航页面】点击按钮');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】点击按钮' });
                targetButton.click();
                console.log('【导航页面】✓ 按钮点击成功');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 按钮点击成功' });
              } catch (e) {
                console.error('【导航页面】❌ 按钮点击失败:', e);
                chrome.runtime.sendMessage({ action: "log", message: `【导航页面】❌ 按钮点击失败: ${e}` });
                throw new Error('按钮点击失败');
              }
              
              // 等待DOM变化
              console.log('【导航页面】等待DOM变化');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】等待DOM变化' });
              const domChanged = await waitForDomChange();
              if (!domChanged) {
                console.log('【导航页面】⚠️ 等待DOM变化超时，尝试继续执行');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】⚠️ 等待DOM变化超时，尝试继续执行' });
              } else {
                console.log('【导航页面】✓ DOM变化完成');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ DOM变化完成' });
              }
              
              // 等待页面稳定
              console.log('【导航页面】等待页面稳定 (10ms)'); // 减少等待时间
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】等待页面稳定 (10ms)' });
              await new Promise(resolve => setTimeout(resolve, 10));
              
              // 检查URL是否变化
              const currentUrl = window.location.href;
              if (currentUrl !== initialUrl) {
                console.log('【导航页面】检测到URL变化:', currentUrl);
                chrome.runtime.sendMessage({ action: "log", message: `【导航页面】检测到URL变化: ${currentUrl}` });
              }
              
              // 如果是最后一步，验证目标节点是否可见
              if (stepIndex === stepsToTake.length - 1 && finalStepId) {
                console.log('【导航页面】这是最后一步，验证目标节点是否可见');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】这是最后一步，验证目标节点是否可见' });
                const finalElement = document.querySelector(`[data-message-id="${finalStepId}"]`);
                if (finalElement) {
                  console.log('【导航页面】✓ 最终目标节点可见');
                  chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 最终目标节点可见' });
                  
                  // 滚动到最终目标节点
                  console.log('【导航页面】滚动到最终目标节点');
                  chrome.runtime.sendMessage({ action: "log", message: '【导航页面】滚动到最终目标节点' });
                  finalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  
                  // 最后一次触发按钮显示
                  console.log('【导航页面】最后一次触发按钮显示');
                  chrome.runtime.sendMessage({ action: "log", message: '【导航页面】最后一次触发按钮显示' });
                  await triggerButtonsDisplay(finalElement);
                } else {
                  console.log('【导航页面】❌ 最终目标节点不可见，导航可能不完全成功');
                  chrome.runtime.sendMessage({ action: "log", message: '【导航页面】❌ 最终目标节点不可见，导航可能不完全成功' });
                }
              }
            }
            
            console.log('【导航页面】✓✓✓ 所有导航步骤处理完成 ✓✓✓');
            chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓✓✓ 所有导航步骤处理完成 ✓✓✓' });
            return { success: true, message: '导航完成' };
          } catch (error) {
            console.error('【导航页面】❌❌❌ 处理步骤时出错:', error);
            chrome.runtime.sendMessage({ action: "log", message: `【导航页面】❌❌❌ 处理步骤时出错: ${error}` });
            return { success: false, message: error instanceof Error ? error.message : String(error) };
          }
        };

        // 执行所有步骤并返回结果
        return await processAllSteps();
      },
      args: [stepsToTake]
    });

    console.log('【导航后台】✓ 导航脚本执行成功');
    return result[0].result;
  } catch (error) {
    console.error('【导航后台】❌ selectBranch 执行出错:', error);
    throw error;
  }
}

async function goToTarget(targetId: string) {
  console.log('【跳转】===== goToTarget 开始执行 =====');
  console.log('【跳转】目标节点 ID:', targetId);
  
  try {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('【跳转】当前活动标签页:', tabs.length > 0 ? tabs[0].url : '无');
    
  const currentTab = tabs[0];
    if (!currentTab.id) {
      console.error('【跳转】❌ 当前标签页没有 ID');
      return;
    }

    console.log('【跳转】开始执行滚动脚本，标签页 ID:', currentTab.id);
  await chrome.scripting.executeScript({
    target: { tabId: currentTab.id ?? 0 },
    func: (targetId) => {
        console.log('【跳转】页面滚动脚本开始执行，目标节点 ID:', targetId);
        chrome.runtime.sendMessage({ action: "log", message: `【跳转】页面滚动脚本开始执行，目标节点 ID: ${targetId}` });
        
      const element = document.querySelector(`[data-message-id="${targetId}"]`);
        console.log('【跳转】查找目标元素结果:', element ? '✓ 找到' : '❌ 未找到');
        chrome.runtime.sendMessage({ action: "log", message: `【跳转】查找目标元素结果: ${element ? '✓ 找到' : '❌ 未找到'}` });
        
      if (element) {
          const tryTriggerButtons = async () => {
            console.log('【跳转】开始尝试触发按钮显示');
            chrome.runtime.sendMessage({ action: "log", message: '【跳转】开始尝试触发按钮显示' });
            
            for (let attempt = 1; attempt <= 5; attempt++) {
              console.log(`【跳转】尝试触发按钮显示 (尝试 ${attempt}/5)`);
              chrome.runtime.sendMessage({ action: "log", message: `【跳转】尝试触发按钮显示 (尝试 ${attempt}/5)` });
              
              // 直接调用triggerButtonsDisplay函数
              const messageGroup = element.closest('.group\\/conversation-turn');
              if (!messageGroup) {
                console.log('【跳转】❌ 未找到消息组容器，无法触发按钮显示');
                chrome.runtime.sendMessage({ action: "log", message: '【跳转】❌ 未找到消息组容器，无法触发按钮显示' });
                return false;
              }
              
              console.log('【跳转】✓ 找到消息组容器');
              chrome.runtime.sendMessage({ action: "log", message: '【跳转】✓ 找到消息组容器' });
              
              // 记录初始按钮状态
              const buttonContainer = messageGroup.querySelector('.mb-2.flex.gap-3, .flex.gap-3, .message-actions');
              const initialButtonCount = buttonContainer?.querySelectorAll('button').length || 0;
              console.log('【跳转】初始按钮数量:', initialButtonCount);
              chrome.runtime.sendMessage({ action: "log", message: `【跳转】初始按钮数量: ${initialButtonCount}` });
              
              // 触发各种事件
              console.log('【跳转】开始触发各种事件');
              chrome.runtime.sendMessage({ action: "log", message: '【跳转】开始触发各种事件' });
              
              const events = [
                new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }),
                new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }),
                new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }),
                new FocusEvent('focus', { bubbles: true, cancelable: true }),
                new MouseEvent('pointerover', { bubbles: true, cancelable: true, view: window }),
                new MouseEvent('pointerenter', { bubbles: true, cancelable: true, view: window })
              ];
              
              // 对消息组触发事件
              events.forEach(event => {
                messageGroup.dispatchEvent(event);
              });
              
              // 对消息元素触发事件
              events.forEach(event => {
                element.dispatchEvent(event);
              });
              
              // 对父元素触发事件
              const parentElements = [
                element.parentElement,
                element.parentElement?.parentElement,
                element.parentElement?.parentElement?.parentElement,
                element.parentElement?.parentElement?.parentElement?.parentElement
              ];
              
              parentElements.forEach(parent => {
                if (parent) {
                  events.forEach(event => {
                    parent.dispatchEvent(event);
                  });
                }
              });
              
              // 尝试点击消息元素
              try {
                console.log('【跳转】尝试点击消息元素');
                chrome.runtime.sendMessage({ action: "log", message: '【跳转】尝试点击消息元素' });
                (element as HTMLElement).click();
              } catch (e) {
                console.log('【跳转】点击消息元素失败:', e);
                chrome.runtime.sendMessage({ action: "log", message: `【跳转】点击消息元素失败: ${e}` });
              }
              
              // 检查按钮是否显示
              await new Promise(resolve => setTimeout(resolve, 10));
              
              const selectors = [
                '.mb-2.flex.gap-3', 
                '.flex.gap-3', 
                '.message-actions button',
                '.message-header button',
                '.flex.items-center button'
              ];
              
              let updatedButtonCount = 0;
              for (const selector of selectors) {
                const container = messageGroup.querySelector(selector);
                if (container) {
                  const buttons = container.querySelectorAll('button');
                  if (buttons.length > updatedButtonCount) {
                    updatedButtonCount = buttons.length;
                  }
                }
              }
              
              console.log('【跳转】触发后按钮数量:', updatedButtonCount);
              chrome.runtime.sendMessage({ action: "log", message: `【跳转】触发后按钮数量: ${updatedButtonCount}` });
              
              const success = updatedButtonCount > initialButtonCount;
              
              if (success) {
                console.log('【跳转】✓ 按钮显示触发成功');
                chrome.runtime.sendMessage({ action: "log", message: '【跳转】✓ 按钮显示触发成功' });
                return true;
              }
              
              if (attempt < 5) {
                console.log('【跳转】❌ 按钮显示触发失败，等待后重试');
                chrome.runtime.sendMessage({ action: "log", message: '【跳转】❌ 按钮显示触发失败，等待后重试' });
                await new Promise(resolve => setTimeout(resolve, 10));
              }
            }
            
            console.log('【跳转】❌ 多次尝试后仍未能触发按钮显示');
            chrome.runtime.sendMessage({ action: "log", message: '【跳转】❌ 多次尝试后仍未能触发按钮显示' });
            return false;
          };
          
          // 修复await表达式错误
          (async () => {
            await tryTriggerButtons();
            
            console.log('【跳转】滚动到目标元素');
            chrome.runtime.sendMessage({ action: "log", message: '【跳转】滚动到目标元素' });
            
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            console.log('【跳转】✓ 滚动完成');
            chrome.runtime.sendMessage({ action: "log", message: '【跳转】✓ 滚动完成' });
          })();
        } else {
          console.log('【跳转】❌ 未找到目标元素，无法滚动');
          chrome.runtime.sendMessage({ action: "log", message: '【跳转】❌ 未找到目标元素，无法滚动' });
      }
    },
    args: [targetId]
    });
    
    console.log('【跳转】✓ 滚动脚本执行成功');
  } catch (error) {
    console.error('【跳转】❌ goToTarget 执行出错:', error);
  }
}

captureHeaders();

const CHATGPT_ORIGIN = 'https://chatgpt.com';

chrome.tabs.onUpdated.addListener(async (tabId, _info, tab) => {
  try {
    if (!tab.url) {
      console.log('No URL found for tab:', tabId);
      return;
    }
    const url = new URL(tab.url);
    if (url.origin === CHATGPT_ORIGIN) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'index.html',
        enabled: true
      });
    } else {
      await chrome.sidePanel.setOptions({
        tabId,
        enabled: false
      });
    }
  } catch (error) {
    console.error('Error in onUpdated listener:', error);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (!tab.url) return;
  const url = new URL(tab.url);
  
  if (url.origin === CHATGPT_ORIGIN) {
    await chrome.sidePanel.setOptions({
      tabId: activeInfo.tabId,
      path: 'index.html',
      enabled: true
    });
  } else {
    await chrome.sidePanel.setOptions({
      tabId: activeInfo.tabId,
      enabled: false
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.url && tab.url.includes('chatgpt.com/c/')) {
    console.log('URL changed to:', tab.url);
    chrome.tabs.sendMessage(tabId, { action: "urlChanged", url: tab.url }).catch(err => {
      console.log('Error sending message to content script:', err);
    });
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.url.includes('chatgpt.com/c/')) {
    console.log('History state updated, URL:', details.url);
    chrome.tabs.sendMessage(details.tabId, { action: "urlChanged", url: details.url }).catch(err => {
      console.log('Error sending message to content script:', err);
    });
  }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
