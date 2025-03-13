import { Node } from '../types/interfaces';


// Traverses up the node tree to find the first parent with valid user content.
// Also cleans up the parent-child relationships by removing invalid intermediate nodes.
export const findFirstContentParent = (node: Node | null | undefined, mapping: Record<string, Node>): Node | null => {
    try {
        if (!node) {
            return null;
        }
        
        // 确保mapping是有效的
        if (!mapping || typeof mapping !== 'object') {
            console.warn('无效的mapping对象');
            return null;
        }
        
        const queue: Node[] = [];
        
        // 安全地添加子节点到队列
        node.children.forEach(childId => {
            if (mapping[childId]) {
                queue.push(mapping[childId]);
            }
        });
        
        while (queue.length > 0) {
            const currentNode = queue.shift()!;
            
            try {
                if (currentNode.message?.content?.parts?.[0] && 
                    currentNode.message.author.role === "user") {
                    
                    if (!currentNode.parent || !mapping[currentNode.parent]) {
                        continue;
                    }
                    
                    let tempParent = mapping[currentNode.parent];
                    
                    tempParent.children.forEach((childId, index) => {
                        try {
                            let currentChild = mapping[childId];
                            
                            if (!currentChild) {
                                return;
                            }
                            
                            while (currentChild && !isValidNode(currentChild)) {
                                if (currentChild.children.length > 0) {
                                    const nextChildId = currentChild.children[0];
                                    if (!mapping[nextChildId]) {
                                        break;
                                    }
                                    currentChild = mapping[nextChildId];
                                } else {
                                    break;
                                }
                            }
                            
                            if (currentChild) {
                                tempParent.children[index] = currentChild.id;
                                currentChild.parent = tempParent.id;
                            }
                        } catch (childError: any) {
                            // 忽略子节点处理错误
                        }
                    });
                    
                    return tempParent;
                }
            } catch (nodeError: any) {
                // 忽略节点处理错误
            }
            
            // 安全地添加子节点到队列
            currentNode.children.forEach(childId => {
                if (mapping[childId]) {
                    queue.push(mapping[childId]);
                }
            });
        }
        
        return null;
    } catch (error: any) {
        return null;
    }
};


// Validates if a node contains meaningful content and is from a supported author type

export const isValidNode = (node: Node): boolean => {
    try {
        // 检查节点是否有内容
        const hasContent = node.message?.content?.parts?.[0] || 
                          (node.message?.content?.content_type === 'user_editable_context' && 
                           node.message?.content?.user_instructions);
        
        // 不再跳过user_editable_context类型的节点
        return !!(hasContent &&
            node.message?.author?.role !== 'system' && 
            node.message?.author?.role !== 'tool' &&
            node.message?.recipient === 'all');
    } catch (error) {
        // 如果出现任何错误，返回false而不是崩溃
        console.warn(`检查节点有效性时出错 [节点ID: ${node?.id}]:`, error);
        return false;
    }
};


// Extracts the text content from a node, handling different content types

export const getNodeContent = (node: Node): string => {
    try {
        if (!node) {
            return 'Empty node';
        }
        
        if (!node.message) {
            return `Node with empty message [ID: ${node.id}]`;
        }
        
        if (!node.message.content) {
            return `Node with empty content [ID: ${node.id}]`;
        }
        
        const contentType = node.message.content.content_type;
        
        if (contentType === 'text' && node.message.content.parts?.[0]) {
            return node.message.content.parts[0];
        }
        
        if (contentType === 'user_editable_context') {
            // 处理自定义GPT的系统指示内容
            if (node.message.content.user_instructions) {
                return node.message.content.user_instructions;
            }
            return 'Custom GPT Instructions';
        }
        
        // 处理其他类型的内容
        if (node.message.content.parts) {
            const textPart = node.message.content.parts.find(part => typeof part === 'string');
            if (textPart) return textPart;
        }
        
        return `No text content found [ID: ${node.id}, Type: ${contentType || 'unknown'}]`;
    } catch (error: any) {
        // 记录错误但返回一个默认值，而不是抛出错误
        console.warn('获取节点内容时出错:', {
            nodeId: node?.id,
            contentType: node?.message?.content?.content_type,
            error: error.message
        });
        return `Error getting content: ${error.message}`;
    }
};