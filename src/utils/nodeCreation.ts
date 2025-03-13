import { Node, Edge, ConversationData } from '../types/interfaces';
import { nodeWidth, nodeHeight } from "../constants/constants";
import { findFirstContentParent, getNodeContent } from './nodeProcessing';
import dagre from '@dagrejs/dagre';

const dagreGraph = new dagre.graphlib.Graph().setGraph({}).setDefaultEdgeLabel(() => ({}));

export const createNodesInOrder = async (
  conversationData: ConversationData,
  checkNodes: (nodeIds: string[]) => Promise<boolean[]>
) => {
  const mapping = conversationData.mapping;
  const newNodes = new Array<Node>();
  const newEdges = new Array<Edge>();

  // 添加错误处理函数
  const handleNodeError = (node: Node, error: any) => {
    // 记录错误，但不中断流程
    console.error(`节点处理错误 [节点ID: ${node.id}]:`, error.message || error);
    
    // 确保节点至少有基本属性
    if (!node.data) {
      node.data = {
        label: `Error: ${error.message || 'Unknown error'}`,
        role: 'system',
        id: node.id,
        hidden: true,
        contentType: 'text',
        visually_hidden: false
      };
    }
    
    return node;
  };

  const createChildNodes = (node: Node) => {
    if (node.children.length === 0) return;
  
    // Recursively finds first descendant with valid content and proper role/recipient
    const findFirstValidDescendant = (currentNode: Node): Node | null => {
      try {
        if (!currentNode) {
          return null;
        }
        
        // 检查节点是否有内容
        const hasContent = currentNode.message?.content?.parts?.[0] || 
                          (currentNode.message?.content?.content_type === 'user_editable_context' && 
                           currentNode.message?.content?.user_instructions);
        
        // 检查节点是否有效 - 不再跳过user_editable_context类型的节点
        if (hasContent &&
            currentNode.message?.author?.role !== 'system' && 
            currentNode.message?.author?.role !== 'tool' &&
            currentNode.message?.recipient === 'all') {
          return currentNode;
        }
    
        // 递归检查子节点
        for (const childId of currentNode.children) {
          if (!mapping[childId]) {
            continue;
          }
          
          const validDescendant = findFirstValidDescendant(mapping[childId]);
          if (validDescendant) return validDescendant;
        }
        return null;
      } catch (error: any) {
        return null;
      }
    };
  
    // Filter and map children to only valid descendants
    const validChildren = node.children
      .map(childId => findFirstValidDescendant(mapping[childId]))
      .filter((child): child is Node => child !== null);
  
    node.children = validChildren.map(child => child.id);
  
    // Process each valid child node
    validChildren.forEach(child => {
      try {
        child.parent = node.id;
        child.type = 'custom';
        
        // 添加空值检查，并在错误消息中包含节点ID
        if (!child.message) {
          console.warn(`节点消息为空 [节点ID: ${child.id}]`);
          // 创建一个带有默认值的节点数据
          child.data = {
            label: `Empty message node [ID: ${child.id}]`,
            role: 'system',
            id: child.id,
            hidden: true,
            contentType: 'text',
            visually_hidden: false
          };
        } else if (!child.message.author) {
          console.warn(`节点作者为空 [节点ID: ${child.id}]`);
          // 创建一个带有默认值的节点数据
          child.data = {
            label: `Node with empty author [ID: ${child.id}]`,
            role: 'system',
            id: child.id,
            hidden: true,
            contentType: child.message.content?.content_type || 'text',
            visually_hidden: false
          };
        } else {
          const role = child.message.author.role;

          // 使用getNodeContent函数获取节点内容
          let content: string;
          try {
            content = getNodeContent(child);
          } catch (contentError: any) {
            console.warn(`获取节点内容失败 [节点ID: ${child.id}]:`, contentError.message);
            content = `Error getting content: ${contentError.message}`;
          }

          // Set node data and visual properties
          child.data = {
            label: content,
            role: role,
            timestamp: child.message.create_time ?? undefined,
            id: child.id,
            hidden: true,
            contentType: child.message.content?.content_type || 'text',
            model_slug: child.message.metadata?.model_slug ?? undefined,
            // 如果是user_editable_context类型，则标记为visually_hidden
            visually_hidden: child.message.content?.content_type === 'user_editable_context'
          };
        }
        
        newNodes.push(child);
        // Create edge connecting parent to child
        newEdges.push({
          id: `${node.id}-${child.id}`,
          source: node.id,
          target: child.id,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#000000', strokeWidth: 2 }
        });
    
        createChildNodes(child);
      } catch (error) {
        // 处理错误但不中断流程
        const fixedNode = handleNodeError(child, error);
        newNodes.push(fixedNode);
        
        // 仍然创建边连接
        newEdges.push({
          id: `${node.id}-${fixedNode.id}`,
          source: node.id,
          target: fixedNode.id,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#000000', strokeWidth: 2, strokeDasharray: '5,5' } // 使用虚线表示有问题的连接
        });
        
        // 尝试继续处理子节点
        if (child.children && child.children.length > 0) {
          createChildNodes(child);
        }
      }
    });
  };

  // Find and setup root node
  let rootNode: Node | null = null;
  try {
    rootNode = findFirstContentParent(
      Object.values(mapping).find(node => !node.parent) as Node,
      mapping
    );
    
    if (!rootNode) {
      // 如果找不到有效的根节点，创建一个虚拟根节点
      console.warn('找不到有效的根节点，创建虚拟根节点');
      rootNode = {
        id: 'virtual-root',
        type: 'custom',
        parent: null,
        children: [] as string[],
        message: null,
        data: {
          label: 'Start of conversation (virtual root)',
          role: 'system',
          hidden: true,
          contentType: 'text',
          visually_hidden: false
        }
      } as Node;
      
      // 尝试找到所有没有父节点的节点作为根节点的子节点
      const orphanNodes = Object.values(mapping).filter(node => 
        !node.parent || !mapping[node.parent]
      );
      
      if (orphanNodes.length > 0) {
        rootNode.children = orphanNodes.map(node => node.id);
        orphanNodes.forEach(node => {
          node.parent = rootNode!.id;
        });
      }
    } else {
      // Initialize root node properties
      rootNode.type = 'custom';
      
      // 添加空值检查，并在错误消息中包含节点ID
      if (!rootNode.message) {
        console.warn(`根节点消息为空 [节点ID: ${rootNode.id}]`);
        rootNode.data = {
          label: `Root node with empty message [ID: ${rootNode.id}]`,
          role: 'system',
          id: rootNode.id,
          hidden: true,
          contentType: 'text',
          visually_hidden: false
        };
      } else if (!rootNode.message.author) {
        console.warn(`根节点作者为空 [节点ID: ${rootNode.id}]`);
        rootNode.data = {
          label: `Root node with empty author [ID: ${rootNode.id}]`,
          role: 'system',
          id: rootNode.id,
          hidden: true,
          contentType: rootNode.message.content?.content_type || 'text',
          visually_hidden: false
        };
      } else {
        // 正常处理根节点
        let content;
        try {
          content = rootNode.message.author.role !== 'system' 
            ? getNodeContent(rootNode)
            : 'Start of your conversation';
        } catch (error: any) {
          console.warn(`获取根节点内容失败 [节点ID: ${rootNode.id}]:`, error);
          content = 'Start of your conversation (error getting content)';
        }
        
        rootNode.data = {
          label: content,
          role: rootNode.message.author.role,
          timestamp: rootNode.message.create_time ?? undefined,
          // 如果是user_editable_context类型，则标记为visually_hidden
          visually_hidden: rootNode.message.content?.content_type === 'user_editable_context'
        };
      }
    }
    
    newNodes.push(rootNode);
    createChildNodes(rootNode);
  } catch (error: any) {
    console.error('处理根节点时出错:', error);
    
    // 创建一个应急的根节点
    rootNode = {
      id: 'emergency-root',
      type: 'custom',
      parent: null,
      children: [] as string[],
      message: null,
      data: {
        label: `Error processing root: ${error.message || 'Unknown error'}`,
        role: 'system',
        hidden: true,
        contentType: 'text',
        visually_hidden: false
      }
    } as Node;
    
    newNodes.push(rootNode);
    
    // 尝试处理所有顶级节点
    const topLevelNodes = Object.values(mapping).filter(node => 
      !node.parent || !mapping[node.parent]
    );
    
    if (topLevelNodes.length > 0) {
      rootNode.children = topLevelNodes.map(node => node.id);
      
      // 处理每个顶级节点
      topLevelNodes.forEach(node => {
        try {
          node.parent = rootNode!.id;
          node.type = 'custom';
          
          if (!node.data) {
            // 尝试设置基本数据
            node.data = {
              label: node.message?.content?.parts?.[0] || 'Unknown content',
              role: node.message?.author?.role || 'unknown',
              id: node.id,
              hidden: true,
              contentType: node.message?.content?.content_type || 'text'
            };
          }
          
          newNodes.push(node);
          newEdges.push({
            id: `${rootNode!.id}-${node.id}`,
            source: rootNode!.id,
            target: node.id,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#000000', strokeWidth: 2, strokeDasharray: '5,5' }
          });
          
          // 继续处理子节点
          createChildNodes(node);
        } catch (nodeError) {
          console.error(`处理顶级节点 ${node.id} 时出错:`, nodeError);
        }
      });
    }
  }
  
  // Update visibility state of nodes
  const existingNodes = await checkNodes(newNodes.map(node => node.id));
  existingNodes.forEach((hidden: boolean, index: number) => {
    if (newNodes[index]) {
      newNodes[index]!.data!.hidden = hidden;
    }
  });

  return layoutNodes(newNodes, newEdges);
};

const layoutNodes = (nodes: Node[], edges: Edge[]) => {
  // Initialize dagre graph with node dimensions
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Apply dagre layout algorithm
  dagre.layout(dagreGraph);

  // Transform nodes with calculated positions
  const nodesWithPositions = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: 'top',
      sourcePosition: 'bottom',
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: nodesWithPositions, edges };
}; 