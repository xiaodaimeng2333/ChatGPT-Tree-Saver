import { Node } from '../types/interfaces';


// Traverses up the node tree to find the first parent with valid user content.
// Also cleans up the parent-child relationships by removing invalid intermediate nodes.
export const findFirstContentParent = (node: Node, mapping: Record<string, Node>): Node | null => {
    try {
        if (!node) {
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
    // 检查节点是否有内容
    const hasContent = node.message?.content?.parts?.[0] || 
                      (node.message?.content?.content_type === 'user_editable_context' && 
                       node.message?.content?.user_instructions);
    
    // 不再跳过user_editable_context类型的节点
    return !!(hasContent &&
        node.message?.author?.role !== 'system' && 
        node.message?.author?.role !== 'tool' &&
        node.message?.recipient === 'all');
};


// Extracts the text content from a node, handling different content types

export const getNodeContent = (node: Node): string => {
    try {
        if (!node) {
            throw new Error('节点为空');
        }
        
        if (!node.message) {
            throw new Error(`节点消息为空 [节点ID: ${node.id}]`);
        }
        
        if (!node.message.content) {
            throw new Error(`节点内容为空 [节点ID: ${node.id}]`);
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
        
        return 'No text provided';
    } catch (error: any) {
        // 重新抛出错误，让调用者处理
        throw error;
    }
};