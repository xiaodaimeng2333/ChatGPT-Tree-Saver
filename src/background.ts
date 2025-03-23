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

// Function to trigger native events for all article elements in the page
async function triggerNativeArticleEvents() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (!currentTab?.id) {
    console.error('No active tab found for triggering native events');
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: currentTab.id },
    func: () => {
      function triggerNativeEvents(element: Element) {
        if (!element) {
          console.error("triggerNativeEvents: Element is null or undefined.");
          return;
        }

        const eventTypes = [
          'mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click',
          'pointerover', 'pointerenter', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel',
          'focus', 'focusin'
        ];

        for (const eventType of eventTypes) {
          try {
            const event = new MouseEvent(eventType, {
              bubbles: true,
              cancelable: true,
              view: window,
            });

            Object.defineProperty(event, 'target', {
              value: element,
              enumerable: true,
              configurable: true
            });
            Object.defineProperty(event, 'currentTarget', {
              value: element,
              enumerable: true,
              configurable: true
            });

            element.dispatchEvent(event);
          } catch (error) {
            console.error(`Error dispatching ${eventType} event:`, error);
          }
        }
      }

      // Keep track of triggered elements.
      const triggeredElements = new Set<Element>();

      function processArticle(article: Element) {
        if (!triggeredElements.has(article)) { //only if not already triggered
          // Trigger events on the article itself.
          triggerNativeEvents(article);

          // Trigger events on each direct child of the article.
          Array.from(article.children).forEach(child => {
            triggerNativeEvents(child);
          });
          triggeredElements.add(article); //remember we triggered.
        }
      }

      function findAndTriggerEvents() {
        const articles = document.querySelectorAll('article[data-testid^="conversation-turn-"]');
        articles.forEach(processArticle);
      }

      function startPollingForNewArticles() {
        let previousArticleCount = document.querySelectorAll('article[data-testid^="conversation-turn-"]').length;
        
        const pollingInterval = setInterval(() => {
          const currentArticleCount = document.querySelectorAll('article[data-testid^="conversation-turn-"]').length;
          
          if (currentArticleCount > previousArticleCount) {
            findAndTriggerEvents();
          }
          
          previousArticleCount = currentArticleCount;
        }, 2000);
        
        setTimeout(() => {
          clearInterval(pollingInterval);
        }, 30000);
      }

      function init() {
        findAndTriggerEvents();
        startPollingForNewArticles();

        const parentContainerSelector = '.mt-1\\.5\\.flex\\.flex-col\\.text-sm\\.\\@thread-xl\\/thread\\:pt-header-height\\.md\\:pb-9';
        const parentContainer = document.querySelector(parentContainerSelector);

        const observer = new MutationObserver(() => {
          findAndTriggerEvents();
        });

        const observeTarget = parentContainer || document.body;
        observer.observe(observeTarget, { childList: true, subtree: true });

        const chatContainer = document.querySelector('main');
        if (chatContainer) {
          const chatObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                setTimeout(() => {
                  findAndTriggerEvents();
                  startPollingForNewArticles();
                }, 500);
                break;
              }
            }
          });
          
          chatObserver.observe(chatContainer, { childList: true, subtree: true });
        }
      }

      // Check if we've already initialized to avoid duplicate observers
      // Use a data attribute on body instead of a window property
      const isInitialized = document.body.hasAttribute('data-events-initialized');
      if (!isInitialized) {
        document.body.setAttribute('data-events-initialized', 'true');
        
        // Ensure DOM is ready
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", init);
        } else {
          init();
        }
      } else {
        // If already initialized, just trigger events for any new articles
        findAndTriggerEvents();
      }
    }
  }).catch(error => {
    console.error('Error executing triggerNativeArticleEvents:', error);
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
          // 成功获取对话历史后触发原生事件
          triggerNativeArticleEvents();
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
    } else if (request.action === "triggerNativeEvents") {
      triggerNativeArticleEvents();
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
    
    // 触发原生事件以确保按钮可见
    await triggerNativeArticleEvents();
    
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

    // 触发原生事件，确保所有按钮可见
    await triggerNativeArticleEvents();

    console.log('【导航后台】开始执行导航脚本');
    const result = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: async (stepsToTake) => {
        console.log('【导航页面】===== 页面导航脚本开始执行 =====');
        console.log('【导航页面】步骤数量:', stepsToTake.length);
        
        // 优化的DOM变化检测，使用更短的超时时间
        const waitForDomChange = (): Promise<boolean> => {
          return new Promise((resolve) => {
            // 更短的最大等待时间
            const maxWaitTime = 300;
            
            const timeout = setTimeout(() => {
              observer.disconnect();
              resolve(false);
            }, maxWaitTime);

            const observer = new MutationObserver((mutations) => {
              // 检查是否有意义的变化表明内容变化
              if (mutations.some(m => 
                  m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0) ||
                  (m.type === 'attributes' && ['style', 'class'].includes(m.attributeName || '')))) {
                clearTimeout(timeout);
                observer.disconnect();
                resolve(true);
              }
            });

            // 观察主要内容区域以更快地检测变化
            const mainContent = document.querySelector('main') || document.body;
            observer.observe(mainContent, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['style', 'class', 'aria-hidden']
            });
          });
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
              
              // 首先尝试使用新的选择器查找元素
              let element = document.querySelector(`article[data-message-id="${step.nodeId}"]`);
              
              // 如果新选择器没找到，尝试旧的选择器
              if (!element) {
                element = document.querySelector(`[data-message-id="${step.nodeId}"]`);
              }
              
              if (!element) {
                console.error('【导航页面】❌ 未找到节点元素，ID:', step.nodeId);
                chrome.runtime.sendMessage({ action: "log", message: `【导航页面】❌ 未找到节点元素，ID: ${step.nodeId}` });
                throw new Error(`未找到节点元素: ${step.nodeId}`);
              }
              console.log('【导航页面】✓ 找到节点元素');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 找到节点元素' });
              
              // 查找按钮容器
              const buttonDiv = element.closest('article') || element.parentElement?.parentElement;
              if (!buttonDiv) {
                console.error('【导航页面】❌ 未找到按钮容器');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】❌ 未找到按钮容器' });
                throw new Error('未找到按钮容器');
              }
              console.log('【导航页面】✓ 找到按钮容器');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 找到按钮容器' });
              
              // 查找目标按钮
              const targetLabel = step.stepsLeft > 0 ? "Previous response" : "Next response";
              const buttons = Array.from(buttonDiv.querySelectorAll("button"));
              const button = buttons.find(btn => 
                btn.getAttribute('aria-label') === targetLabel ||
                btn.getAttribute('aria-label') === (step.stepsLeft > 0 ? "上一回复" : "下一回复")
              );
              
              if (!button) {
                console.error('【导航页面】❌ 未找到所需的按钮');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】❌ 未找到所需的按钮' });
                
                // 尝试触发原生事件来显示按钮
                console.log('【导航页面】尝试触发原生事件来显示按钮');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】尝试触发原生事件来显示按钮' });
                
                // 触发事件
                const eventTypes = [
                  'mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click',
                  'pointerover', 'pointerenter', 'pointerdown', 'pointerup', 'pointermove'
                ];
                
                for (const eventType of eventTypes) {
                  try {
                    const event = new MouseEvent(eventType, {
                      bubbles: true,
                      cancelable: true,
                      view: window,
                    });
                    buttonDiv.dispatchEvent(event);
                  } catch (err) {
                    console.error(`触发${eventType}事件失败:`, err);
                  }
                }
                
                // 等待一段时间后再次尝试
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // 再次查找按钮
                const buttonsRetry = Array.from(buttonDiv.querySelectorAll("button"));
                const buttonRetry = buttonsRetry.find(btn => 
                  btn.getAttribute('aria-label') === targetLabel ||
                  btn.getAttribute('aria-label') === (step.stepsLeft > 0 ? "上一回复" : "下一回复")
                );
                
                if (!buttonRetry) {
                  throw new Error('在重试后仍未找到所需的按钮');
                }
                
                // 点击找到的按钮
                console.log('【导航页面】在重试后找到按钮，准备点击');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】在重试后找到按钮，准备点击' });
                buttonRetry.click();
              } else {
                console.log('【导航页面】✓ 找到所需按钮，准备点击');
                chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 找到所需按钮，准备点击' });
                button.click();
              }
              
              console.log('【导航页面】✓ 按钮点击成功');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 按钮点击成功' });
              
              // 等待DOM变化
              console.log('【导航页面】等待DOM变化');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】等待DOM变化' });
              await waitForDomChange();
              
              // 等待页面稳定
              console.log('【导航页面】等待页面稳定 (50ms)');
              chrome.runtime.sendMessage({ action: "log", message: '【导航页面】等待页面稳定 (50ms)' });
              await new Promise(resolve => setTimeout(resolve, 50));
              
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
                
                // 尝试新的选择器
                let finalElement = document.querySelector(`article[data-message-id="${finalStepId}"]`);
                
                // 如果新选择器没找到，尝试旧的选择器
                if (!finalElement) {
                  finalElement = document.querySelector(`[data-message-id="${finalStepId}"]`);
                }
                
                if (finalElement) {
                  console.log('【导航页面】✓ 最终目标节点可见');
                  chrome.runtime.sendMessage({ action: "log", message: '【导航页面】✓ 最终目标节点可见' });
                  
                  // 滚动到最终目标节点
                  console.log('【导航页面】滚动到最终目标节点');
                  chrome.runtime.sendMessage({ action: "log", message: '【导航页面】滚动到最终目标节点' });
                  finalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    // 首先触发原生事件
    await triggerNativeArticleEvents();
    
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
        
        // 首先尝试使用新的选择器查找元素
        let element = document.querySelector(`article[data-message-id="${targetId}"]`);
        
        // 如果新选择器没找到，尝试旧的选择器
        if (!element) {
          element = document.querySelector(`[data-message-id="${targetId}"]`);
        }
        
        console.log('【跳转】查找目标元素结果:', element ? '✓ 找到' : '❌ 未找到');
        chrome.runtime.sendMessage({ action: "log", message: `【跳转】查找目标元素结果: ${element ? '✓ 找到' : '❌ 未找到'}` });
        
        if (element) {
          // 滚动到元素
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          console.log('【跳转】✓ 滚动完成');
          chrome.runtime.sendMessage({ action: "log", message: '【跳转】✓ 滚动完成' });
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
      
      // 页面加载或更新时触发原生事件
      setTimeout(() => {
        triggerNativeArticleEvents();
      }, 1500);
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
    
    // 切换到ChatGPT标签页时触发原生事件
    setTimeout(() => {
      triggerNativeArticleEvents();
    }, 500);
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
    
    // URL变化时触发原生事件
    setTimeout(() => {
      triggerNativeArticleEvents();
    }, 1000);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.url.includes('chatgpt.com/c/')) {
    console.log('History state updated, URL:', details.url);
    chrome.tabs.sendMessage(details.tabId, { action: "urlChanged", url: details.url }).catch(err => {
      console.log('Error sending message to content script:', err);
    });
    
    // 历史状态更新时触发原生事件
    setTimeout(() => {
      triggerNativeArticleEvents();
    }, 1000);
  }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
