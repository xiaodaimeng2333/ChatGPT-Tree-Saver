import { useState, useRef, useEffect } from 'react';
import { ContextMenuProps } from '../types/interfaces';

export const ContextMenu = (props: ContextMenuProps) => {
    // Group state declarations
    const [showInput, setShowInput] = useState(false);
    const [inputValue, setInputValue] = useState(props.role === 'user' ? (props.message || '') : '');
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                props.onClick?.();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [props.onClick]);

    const handleActionClick = () => {
        if (props.role === 'user') {
            setInputValue(props.message || '');
        } else {
            setInputValue('');
        }
        setShowInput(true);
    };

    const handleSend = async () => {
        if (!inputValue.trim()) return;

        try {
            if (props.hidden) {
                await selectBranch();
            }
            
            if (props.role === 'user') {
                await editMessage();
            } else if (props.role === 'assistant') {
                await respondToMessage();
            }
            
            setShowInput(false);
            setInputValue('');
            props.refreshNodes();
        } catch (error) {
            console.error('操作失败:', error);
            alert(`操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    };

    // API interaction functions
    const editMessage = async () => {
        const response = await chrome.runtime.sendMessage({ 
            action: 'editMessage', 
            messageId: props.messageId, 
            message: inputValue,
            requireCompletion: true
        });
        
        if (!response.completed) {
            console.error('Edit message failed:', response.error);
            throw new Error(`编辑消息失败: ${response.error || '未知错误'}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        props.refreshNodes();
    };

    const respondToMessage = async () => {
        const response = await chrome.runtime.sendMessage({ 
            action: 'respondToMessage', 
            childrenIds: props.childrenIds, 
            message: inputValue,
            requireCompletion: true
        });
        
        if (!response.completed) {
            console.error('Response message failed:', response.error);
            throw new Error(`回复消息失败: ${response.error || '未知错误'}`);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        props.refreshNodes();
    };

    const selectBranch = async () => {
        if (!props.messageId) return;

        console.log('【导航】===== selectBranch 开始执行 =====');
        console.log('【导航】目标节点ID:', props.messageId);
        
        const steps = props.onNodeClick(props.messageId);
        console.log('【导航】计算出的导航步骤:', JSON.stringify(steps, null, 2));
        
        if (!steps || steps.length === 0) {
            console.log('【导航】没有计算出导航步骤，退出导航');
            return;
        }

        try {
            // 最大重试次数
            const maxRetries = 5;
            let retryCount = 0;
            let navigationSuccess = false;
            
            while (!navigationSuccess && retryCount < maxRetries) {
                if (retryCount > 0) {
                    console.log(`【导航】第 ${retryCount} 次重试导航`);
                }
                
                // 执行导航步骤
                console.log('【导航】开始执行导航步骤，总步数:', steps.length);
                
                // 使用新的一次性导航方法
                const execResponse = await chrome.runtime.sendMessage({ 
                    action: "selectBranch", 
                    steps: steps
                });
                
                if (!execResponse || !execResponse.success) {
                    console.error('【导航】❌ 导航执行失败:', execResponse);
                    if (retryCount >= maxRetries - 1) {
                        throw new Error('导航执行失败');
                    }
                    retryCount++;
                    continue;
                }
                
                console.log('【导航】✓ 导航执行成功');
                
                // 等待DOM更新
                console.log('【导航】等待DOM更新 (1ms)');
                await new Promise(resolve => setTimeout(resolve, 1));
                
                // 刷新节点状态
                console.log('【导航】刷新节点状态');
                props.onRefresh();
                
                // 等待节点状态更新
                console.log('【导航】等待节点状态更新 (1ms)');
                await new Promise(resolve => setTimeout(resolve, 1));
                
                // 验证导航是否成功
                console.log('【导航】验证导航是否成功');
                try {
                    const verifyResponse = await chrome.runtime.sendMessage({
                        action: "checkNodes",
                        nodeIds: [props.messageId]
                    });
                    
                    if (verifyResponse && verifyResponse.success && Array.isArray(verifyResponse.existingNodes)) {
                        // existingNodes[0]为true表示节点不存在，为false表示节点存在
                        if (!verifyResponse.existingNodes[0]) {
                            console.log('【导航】✓ 导航成功，目标节点可见');
                            navigationSuccess = true;
                        } else {
                            console.log('【导航】⚠️ 导航不完全成功，目标节点可能仍然隐藏，将重试');
                        }
                    } else {
                        console.log('【导航】⚠️ 验证响应无效，将重试');
                    }
                } catch (error) {
                    console.error('【导航】❌ 验证导航时出错:', error);
                }
                
                if (!navigationSuccess) {
                    if (retryCount >= maxRetries - 1) {
                        console.error('【导航】❌ 达到最大重试次数，导航失败');
                        throw new Error('导航失败：目标节点仍然隐藏');
                    }
                }
                
                retryCount++;
            }
            
            if (navigationSuccess) {
                console.log('【导航】===== 导航过程成功完成 =====');
            } else {
                console.error('【导航】===== 导航过程失败 =====');
                throw new Error('导航失败：无法使目标节点可见');
            }
        } catch (error) {
            console.error('【导航】❌ 导航过程出错:', error);
            throw error; // 重新抛出错误，让调用者知道导航失败
        }
    };

    // Render helpers
    const getPositionStyle = () => ({
        position: 'absolute' as const,
        top: typeof props.top === 'number' ? `${props.top}px` : undefined,
        left: typeof props.left === 'number' ? `${props.left}px` : undefined,
        right: typeof props.right === 'number' ? `${props.right}px` : undefined,
        bottom: typeof props.bottom === 'number' ? `${props.bottom}px` : undefined,
    });

    return (
        <div
            ref={menuRef}
            style={getPositionStyle()}
            className="bg-white shadow-lg rounded-lg p-3 z-50 min-w-[180px]"
        >
            {props.role && (
                <div className="px-2 py-1 text-xs text-gray-500 border-b border-gray-100">
                    Role: {props.role}
                </div>
            )}
            <div className="mt-1 space-y-1">
                <button 
                    className="w-full px-2 py-1.5 text-sm text-left text-gray-700 hover:bg-gray-50 rounded transition-colors" 
                    onClick={selectBranch}
                >
                    Select
                </button>
                {(props.childrenIds && props.childrenIds.length > 0) && (
                    <button 
                        className="w-full px-2 py-1.5 text-sm text-left text-gray-700 hover:bg-gray-50 rounded transition-colors" 
                        onClick={handleActionClick}
                    >
                        {props.role === 'user' ? 'Edit this message' : 'Respond to this message'}
                    </button>
                )}
                {showInput && (
                    <div className="mt-2">
                        <div className="relative flex flex-col">
                            <textarea
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && e.metaKey) {
                                        handleSend();
                                    }
                                }}
                                className="w-full px-4 py-2 text-sm text-gray-700 border rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 min-h-[100px] resize-y"
                                placeholder={props.role === 'user' ? "Edit message..." : "Type your response..."}
                                autoFocus
                            />
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-xs text-gray-500">Press ⌘+Enter to send</span>
                                <button 
                                    onClick={handleSend}
                                    className="px-3 py-1 text-sm text-white bg-blue-500 rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
                                    disabled={!inputValue.trim()}
                                >
                                    Send
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};