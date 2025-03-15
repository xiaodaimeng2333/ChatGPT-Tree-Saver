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
  console.log('【调试】background.ts - selectBranch 开始执行，步骤数量:', stepsToTake.length);
  console.log('【调试】步骤详情:', JSON.stringify(stepsToTake, null, 2));
  
  try {
    if (!Array.isArray(stepsToTake)) {
      console.error('【调试】stepsToTake 不是数组');
      throw new Error('stepsToTake must be an array');
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('【调试】当前活动标签页:', tabs.length > 0 ? tabs[0].url : '无');
    
    if (!tabs || tabs.length === 0) {
      console.error('【调试】未找到活动标签页');
      throw new Error('No active tab found');
    }
    const currentTab = tabs[0];
    if (!currentTab.id) {
      console.error('【调试】当前标签页没有 ID');
      throw new Error('Current tab has no ID');
    }

    console.log('【调试】开始执行脚本，标签页 ID:', currentTab.id);
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: (stepsToTake) => {
        console.log('【调试】页面脚本开始执行，步骤数量:', stepsToTake.length);
        
        const waitForDomChange = (element: Element): Promise<void> => {
          return new Promise((resolve, reject) => {
            const maxWaitTime = 5000; // 5 seconds maximum wait
            const timeout = setTimeout(() => {
              observer.disconnect();
              console.error('【调试】等待 DOM 变化超时');
              reject(new Error('Timeout waiting for DOM changes'));
            }, maxWaitTime);

            const observer = new MutationObserver((_mutations, obs) => {
              clearTimeout(timeout);
              obs.disconnect();
              console.log('【调试】检测到 DOM 变化');
              resolve();
            });

            observer.observe(element, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });
            console.log('【调试】开始观察 DOM 变化');
          });
        };

        const triggerButtonsDisplay = (element: Element): Promise<boolean> => {
          return new Promise((resolve) => {
            console.log('【按钮刷新开始】目标元素:', element.getAttribute('data-message-id'));
            
            const messageGroup = element.closest('.group\\/conversation-turn');
            if (!messageGroup) {
              console.error('【按钮刷新失败】未找到消息组容器');
              resolve(false);
              return;
            }
            
            console.log('【按钮刷新进行】找到消息组容器');
            
            // 记录初始状态
            const buttonContainer = messageGroup.querySelector('.mb-2.flex.gap-3');
            const initialButtonCount = buttonContainer?.querySelectorAll('button').length || 0;
            console.log('【按钮刷新进行】初始按钮数量:', initialButtonCount);
            
            const messageContent = messageGroup.querySelector('.min-h-8.text-message');
            const messageAuthorRole = messageContent?.getAttribute('data-message-author-role');
            console.log('【按钮刷新进行】消息作者角色:', messageAuthorRole);
            
            const messageElement = messageGroup.querySelector('[data-message-id]');
            if (!messageElement) {
              console.error('【按钮刷新失败】未找到消息元素');
              resolve(false);
              return;
            }
            
            console.log('【按钮刷新进行】找到消息元素，开始触发事件');
            
            // 创建事件集合
            const events = [
              new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }),
              new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }),
              new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }),
              new MouseEvent('focus', { bubbles: true, cancelable: true, view: window })
            ];
            
            // 强制触发所有可能的位置
            const elementsToTrigger = [
              messageGroup,
              messageElement,
              messageElement.parentElement,
              messageElement.parentElement?.parentElement,
              messageElement.parentElement?.parentElement?.parentElement,
              messageContent,
              messageGroup.querySelector('.message-actions'),
              messageGroup.querySelector('.message-header'),
              messageGroup.querySelector('.flex-1'),
              messageGroup.querySelector('.flex'),
              ...(Array.from(messageGroup.querySelectorAll('.flex'))),
              ...(Array.from(messageGroup.querySelectorAll('.mb-2'))),
              ...(Array.from(messageGroup.querySelectorAll('.gap-3'))),
              ...(Array.from(messageGroup.querySelectorAll('.flex-row-reverse')))
            ].filter(el => el != null);
            
            console.log('【按钮刷新进行】找到可触发元素数量:', elementsToTrigger.length);
            
            // 对每个元素触发所有事件
            elementsToTrigger.forEach(el => {
              if (el) {
                events.forEach(event => {
                  el.dispatchEvent(event);
                });
                
                // 尝试直接点击
                try {
                  (el as HTMLElement).click();
                } catch (e) {
                  // 忽略错误
                }
              }
            });
            
            // 直接移动鼠标到元素中心
            try {
              const rect = messageElement.getBoundingClientRect();
              const centerX = rect.left + rect.width / 2;
              const centerY = rect.top + rect.height / 2;
              
              const moveEvent = new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX,
                clientY: centerY
              });
              
              document.elementFromPoint(centerX, centerY)?.dispatchEvent(moveEvent);
              messageElement.dispatchEvent(moveEvent);
              messageGroup.dispatchEvent(moveEvent);
            } catch (e) {
              console.log('【按钮刷新进行】触发鼠标移动事件失败:', e);
            }
            
            // 检查结果
            setTimeout(() => {
              // 查找所有可能的按钮容器
              const possibleContainers = [
                messageGroup.querySelector('.mb-2.flex.gap-3'),
                messageGroup.querySelector('.flex.gap-3'),
                messageGroup.querySelector('.mb-2.flex'),
                messageGroup.querySelector('.message-actions'),
                ...Array.from(messageGroup.querySelectorAll('.flex.gap-3')),
                ...Array.from(messageGroup.querySelectorAll('.mb-2.flex'))
              ].filter(el => el != null);
              
              console.log('【按钮刷新进行】找到可能的按钮容器数量:', possibleContainers.length);
              
              // 在所有容器中查找按钮
              let maxButtonCount = 0;
              possibleContainers.forEach(container => {
                if (container) {
                  const buttons = container.querySelectorAll('button');
                  if (buttons.length > maxButtonCount) {
                    maxButtonCount = buttons.length;
                  }
                }
              });
              
              console.log('【按钮刷新进行】找到最大按钮数量:', maxButtonCount);
              
              // 寻找特定导航按钮
              const allButtons = Array.from(messageGroup.querySelectorAll('button'));
              const hasNavigationButtons = allButtons.some(button => {
                const ariaLabel = button.getAttribute('aria-label');
                return ariaLabel === "Previous response" || ariaLabel === "Next response" || 
                       ariaLabel === "上一回复" || ariaLabel === "下一回复";
              });
              
              console.log('【按钮刷新进行】是否找到导航按钮:', hasNavigationButtons);
              console.log('【按钮刷新进行】消息组中的所有按钮数量:', allButtons.length);
              
              // 成功条件：按钮数量增加或存在导航按钮
              const success = maxButtonCount > initialButtonCount || hasNavigationButtons || allButtons.length >= 2;
              console.log('【按钮刷新' + (success ? '成功' : '失败') + '】最终结果');
              
              resolve(success);
            }, 50);
          });
        };

        const processSteps = async () => {
          try {
            console.log('【调试】开始处理导航步骤');
            let buttonDiv: Element | null = null;
            
            for (const step of stepsToTake) {
              console.log('【调试】处理步骤:', JSON.stringify(step));
              
              if (!step.nodeId) {
                console.error('【调试】步骤缺少 nodeId');
                throw new Error('Step missing nodeId');
              }

              console.log('【调试】查找节点元素，ID:', step.nodeId);
              const element = document.querySelector(`[data-message-id="${step.nodeId}"]`);
              if (!element) {
                console.error('【调试】未找到节点元素，ID:', step.nodeId);
                throw new Error(`Element not found for nodeId: ${step.nodeId}`);
              }
              console.log('【调试】找到节点元素');
              
              const parentElement = element.parentElement?.parentElement;
              buttonDiv = parentElement || null;
              if (!buttonDiv) {
                console.error('【调试】未找到按钮容器');
                throw new Error(`Button container not found for nodeId: ${step.nodeId}`);
              }
              console.log('【调试】找到按钮容器');
              
              // 强制触发按钮显示，每步都执行
              console.log(`【调试】开始为节点 ${step.nodeId} 强制触发按钮显示`);
              let buttonDisplaySuccess = false;
              for (let attempt = 1; attempt <= 5; attempt++) {
                console.log(`【调试】按钮刷新尝试 ${attempt}/5`);
                buttonDisplaySuccess = await triggerButtonsDisplay(element);
                if (buttonDisplaySuccess) {
                  console.log('【调试】按钮显示触发成功');
                  break;
                }
                
                console.log('【调试】按钮显示触发失败，等待后重试');
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              
              if (!buttonDisplaySuccess) {
                console.error('【调试】多次尝试后仍未能触发按钮显示，尝试继续执行');
              }

              let currentButtons = buttonDiv.querySelectorAll("button");
              console.log('【调试】找到按钮数量:', currentButtons.length);
              
              if (!currentButtons || currentButtons.length < 2) {
                console.log('【调试】按钮数量不足，进行紧急按钮刷新');
                const messageGroup = element.closest('.group\\/conversation-turn');
                if (messageGroup) {
                  console.log('【调试】找到消息组，尝试直接查找所有按钮');
                  const allButtons = messageGroup.querySelectorAll('button');
                  console.log('【调试】消息组中找到按钮数量:', allButtons.length);
                  
                  const events = [
                    new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }),
                    new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }),
                    new FocusEvent('focus', { bubbles: true, cancelable: true })
                  ];
                  
                  events.forEach(event => {
                    messageGroup.dispatchEvent(event);
                    element.dispatchEvent(event);
                  });
                  
                  await new Promise(resolve => setTimeout(resolve, 100));
                  currentButtons = buttonDiv.querySelectorAll("button");
                  console.log('【调试】紧急刷新后按钮数量:', currentButtons.length);
                }
                
                if (!currentButtons || currentButtons.length < 2) {
                  console.error('【调试】多次尝试后按钮数量仍不足');
                  throw new Error(`Required buttons not found for nodeId: ${step.nodeId}`);
                }
              }

              let targetButton = null;
              
              const findButton = () => {
                console.log('【调试】开始查找方向按钮，步骤方向:', step.stepsLeft > 0 ? '左' : '右');
                
                // 通过aria-label查找
                const buttonByLabel = Array.from(currentButtons).find((button: Element) => {
                  const ariaLabel = button.getAttribute('aria-label');
                  console.log('【调试】检查按钮 aria-label:', ariaLabel);
                  return step.stepsLeft > 0 ? 
                    (ariaLabel === "Previous response" || ariaLabel === "上一回复") :
                    (ariaLabel === "Next response" || ariaLabel === "下一回复");
                });
                
                if (buttonByLabel) {
                  console.log('【调试】通过aria-label找到按钮');
                  return buttonByLabel;
                }
                
                // 通过SVG路径查找
                for (let i = 0; i < currentButtons.length; i++) {
                  const button = currentButtons[i];
                  const svg = button.querySelector('svg');
                  if (svg) {
                    const path = svg.querySelector('path');
                    if (path) {
                      const d = path.getAttribute('d');
                      const isLeftArrow = d && d.includes('14.7071 5.29289') && d.includes('7.29289 11.2929');
                      const isRightArrow = d && d.includes('9.29289 18.7071') && d.includes('16.7071 11.2929');
                      
                      console.log('【调试】检查SVG路径:', d?.substring(0, 20) + '...');
                      console.log('【调试】是左箭头:', isLeftArrow, '是右箭头:', isRightArrow);
                      
                      if ((step.stepsLeft > 0 && isLeftArrow) || (step.stepsLeft <= 0 && isRightArrow)) {
                        console.log('【调试】通过SVG路径找到按钮，索引:', i);
                        return button;
                      }
                    }
                  }
                }
                
                // 通过位置猜测
                if (currentButtons.length >= 2) {
                  const index = step.stepsLeft > 0 ? 0 : Math.min(2, currentButtons.length - 1);
                  console.log('【调试】通过位置猜测找到按钮，索引:', index);
                  return currentButtons[index];
                }
                
                return null;
              };
              
              targetButton = findButton();
              
              if (!targetButton) {
                console.error('【调试】未找到所需的按钮');
                throw new Error(`Button with required direction not found for nodeId: ${step.nodeId}`);
              }
              
              console.log('【调试】找到所需按钮，准备点击');
              
              try {
                targetButton.click();
                console.log('【调试】按钮点击成功');
              } catch (e: unknown) {
                console.error('【调试】按钮点击失败:', e);
                throw new Error(`Failed to click button: ${e instanceof Error ? e.message : String(e)}`);
              }
              
              try {
                console.log('【调试】等待 DOM 变化');
                await waitForDomChange(buttonDiv);
                console.log('【调试】DOM 变化完成，继续下一步');
              } catch (error) {
                console.error('【调试】等待 DOM 变化时出错:', error);
                throw error;
              }
            }
            console.log('【调试】所有导航步骤处理完成');
          } catch (error) {
            console.error('【调试】处理步骤时出错:', error);
            throw error;
          }
        };

        processSteps().catch(error => {
          console.error('【调试】处理步骤失败:', error);
        });
      },
      args: [stepsToTake]
    }).catch(error => {
      console.error('【调试】脚本执行失败:', error);
      throw error;
    });

    console.log('【调试】脚本执行成功');
  } catch (error) {
    console.error('【调试】selectBranch 执行出错:', error);
    throw error;
  }
}

async function goToTarget(targetId: string) {
  console.log('【调试】background.ts - goToTarget 开始执行，目标节点 ID:', targetId);
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('【调试】当前活动标签页:', tabs.length > 0 ? tabs[0].url : '无');
    
    const currentTab = tabs[0];
    if (!currentTab.id) {
      console.error('【调试】当前标签页没有 ID');
      return;
    }

    console.log('【调试】开始执行滚动脚本，标签页 ID:', currentTab.id);
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id ?? 0 },
      func: (targetId) => {
        console.log('【调试】页面滚动脚本开始执行，目标节点 ID:', targetId);
        
        // 重用与processSteps中相同的按钮刷新逻辑
        const triggerButtonsDisplay = (element: Element): Promise<boolean> => {
          return new Promise((resolve) => {
            console.log('【按钮刷新开始】goToTarget中触发，目标元素:', element.getAttribute('data-message-id'));
            
            const messageGroup = element.closest('.group\\/conversation-turn');
            if (!messageGroup) {
              console.error('【按钮刷新失败】未找到消息组容器');
              resolve(false);
              return;
            }
            
            console.log('【按钮刷新进行】找到消息组容器');
            
            // 记录初始状态
            const buttonContainer = messageGroup.querySelector('.mb-2.flex.gap-3');
            const initialButtonCount = buttonContainer?.querySelectorAll('button').length || 0;
            console.log('【按钮刷新进行】初始按钮数量:', initialButtonCount);
            
            const messageContent = messageGroup.querySelector('.min-h-8.text-message');
            const messageAuthorRole = messageContent?.getAttribute('data-message-author-role');
            console.log('【按钮刷新进行】消息作者角色:', messageAuthorRole);
            
            const messageElement = messageGroup.querySelector('[data-message-id]');
            if (!messageElement) {
              console.error('【按钮刷新失败】未找到消息元素');
              resolve(false);
              return;
            }
            
            console.log('【按钮刷新进行】找到消息元素，开始触发事件');
            
            // 创建事件集合
            const events = [
              new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }),
              new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }),
              new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }),
              new MouseEvent('focus', { bubbles: true, cancelable: true, view: window })
            ];
            
            // 强制触发所有可能的位置
            const elementsToTrigger = [
              messageGroup,
              messageElement,
              messageElement.parentElement,
              messageElement.parentElement?.parentElement,
              messageElement.parentElement?.parentElement?.parentElement,
              messageContent,
              messageGroup.querySelector('.message-actions'),
              messageGroup.querySelector('.message-header'),
              messageGroup.querySelector('.flex-1'),
              messageGroup.querySelector('.flex'),
              ...(Array.from(messageGroup.querySelectorAll('.flex'))),
              ...(Array.from(messageGroup.querySelectorAll('.mb-2'))),
              ...(Array.from(messageGroup.querySelectorAll('.gap-3'))),
              ...(Array.from(messageGroup.querySelectorAll('.flex-row-reverse')))
            ].filter(el => el != null);
            
            console.log('【按钮刷新进行】找到可触发元素数量:', elementsToTrigger.length);
            
            // 对每个元素触发所有事件
            elementsToTrigger.forEach(el => {
              if (el) {
                events.forEach(event => {
                  el.dispatchEvent(event);
                });
                
                // 尝试直接点击
                try {
                  (el as HTMLElement).click();
                } catch (e) {
                  // 忽略错误
                }
              }
            });
            
            // 直接移动鼠标到元素中心
            try {
              const rect = messageElement.getBoundingClientRect();
              const centerX = rect.left + rect.width / 2;
              const centerY = rect.top + rect.height / 2;
              
              const moveEvent = new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX,
                clientY: centerY
              });
              
              document.elementFromPoint(centerX, centerY)?.dispatchEvent(moveEvent);
              messageElement.dispatchEvent(moveEvent);
              messageGroup.dispatchEvent(moveEvent);
            } catch (e) {
              console.log('【按钮刷新进行】触发鼠标移动事件失败:', e);
            }
            
            // 检查结果
            setTimeout(() => {
              // 查找所有可能的按钮容器
              const possibleContainers = [
                messageGroup.querySelector('.mb-2.flex.gap-3'),
                messageGroup.querySelector('.flex.gap-3'),
                messageGroup.querySelector('.mb-2.flex'),
                messageGroup.querySelector('.message-actions'),
                ...Array.from(messageGroup.querySelectorAll('.flex.gap-3')),
                ...Array.from(messageGroup.querySelectorAll('.mb-2.flex'))
              ].filter(el => el != null);
              
              console.log('【按钮刷新进行】找到可能的按钮容器数量:', possibleContainers.length);
              
              // 在所有容器中查找按钮
              let maxButtonCount = 0;
              possibleContainers.forEach(container => {
                if (container) {
                  const buttons = container.querySelectorAll('button');
                  if (buttons.length > maxButtonCount) {
                    maxButtonCount = buttons.length;
                  }
                }
              });
              
              console.log('【按钮刷新进行】找到最大按钮数量:', maxButtonCount);
              
              // 寻找特定导航按钮
              const allButtons = Array.from(messageGroup.querySelectorAll('button'));
              const hasNavigationButtons = allButtons.some(button => {
                const ariaLabel = button.getAttribute('aria-label');
                return ariaLabel === "Previous response" || ariaLabel === "Next response" || 
                      ariaLabel === "上一回复" || ariaLabel === "下一回复";
              });
              
              console.log('【按钮刷新进行】是否找到导航按钮:', hasNavigationButtons);
              console.log('【按钮刷新进行】消息组中的所有按钮数量:', allButtons.length);
              
              // 成功条件：按钮数量增加或存在导航按钮
              const success = maxButtonCount > initialButtonCount || hasNavigationButtons || allButtons.length >= 2;
              console.log('【按钮刷新' + (success ? '成功' : '失败') + '】最终结果');
              
              resolve(success);
            }, 50);
          });
        };
        
        const element = document.querySelector(`[data-message-id="${targetId}"]`);
        console.log('【调试】查找目标元素结果:', element ? '找到' : '未找到');
        
        if (element) {
          const tryTriggerButtons = async () => {
            console.log('【调试】开始尝试触发按钮显示');
            for (let attempt = 1; attempt <= 5; attempt++) {
              console.log(`【调试】goToTarget - 按钮刷新尝试 ${attempt}/5`);
              const success = await triggerButtonsDisplay(element);
              
              if (success) {
                console.log('【调试】goToTarget - 按钮显示触发成功');
                return true;
              }
              
              console.log('【调试】goToTarget - 按钮显示触发失败，等待后重试');
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            console.log('【调试】goToTarget - 多次尝试后仍未能触发按钮显示');
            return false;
          };
          
          tryTriggerButtons().then(() => {
            console.log('【调试】滚动到目标元素');
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
      },
      args: [targetId]
    });
    
    console.log('【调试】滚动脚本执行成功');
  } catch (error) {
    console.error('【调试】goToTarget 执行出错:', error);
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
