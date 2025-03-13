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
    // 只保留错误信息，不输出到控制台
    throw new Error(`节点处理错误 [节点ID: ${node.id}]: ${error.message || error}`);
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
          throw new Error(`节点消息为空 [节点ID: ${child.id}]`);
        }
        
        if (!child.message.author) {
          throw new Error(`节点作者为空 [节点ID: ${child.id}]`);
        }
        
        const role = child.message.author.role;

        // 使用getNodeContent函数获取节点内容
        let content: string;
        try {
          content = getNodeContent(child);
        } catch (contentError: any) {
          throw new Error(`获取节点内容失败 [节点ID: ${child.id}]: ${contentError.message}`);
        }

        // Set node data and visual properties
        child.data = {
          label: content,
          role: role,
          timestamp: child.message.create_time ?? undefined,
          id: child.id,
          hidden: true,
          contentType: child.message.content.content_type,
          model_slug: child.message.metadata.model_slug ?? undefined,
          // 如果是user_editable_context类型，则标记为visually_hidden
          visually_hidden: child.message.content.content_type === 'user_editable_context'
        };
        
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
        handleNodeError(child, error);
        // 继续处理其他节点，不中断整个流程
      }
    });
  };

  // Find and setup root node
  let rootNode;
  try {
    rootNode = findFirstContentParent(
      Object.values(mapping).find(node => !node.parent) as Node,
      mapping
    );
    
    if (!rootNode) return { nodes: [], edges: [] };

    // Initialize root node properties
    rootNode.type = 'custom';
    
    // 添加空值检查，并在错误消息中包含节点ID
    if (!rootNode.message) {
      throw new Error(`根节点消息为空 [节点ID: ${rootNode.id}]`);
    }
    
    if (!rootNode.message.author) {
      throw new Error(`根节点作者为空 [节点ID: ${rootNode.id}]`);
    }
    
    rootNode.data = {
      label: rootNode.message.author.role !== 'system' 
        ? getNodeContent(rootNode)
        : 'Start of your conversation',
      role: rootNode.message.author.role,
      timestamp: rootNode.message.create_time ?? undefined,
      // 如果是user_editable_context类型，则标记为visually_hidden
      visually_hidden: rootNode.message.content.content_type === 'user_editable_context'
    };
    
    newNodes.push(rootNode);
    createChildNodes(rootNode);
  } catch (error) {
    if (rootNode) {
      handleNodeError(rootNode, error);
    }
    // 如果根节点处理失败，返回空结果
    return { nodes: [], edges: [] };
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