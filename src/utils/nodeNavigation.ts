import { Node } from '../types/interfaces';

export const calculateSteps = (nodes: Node[], targetId: string) => {
  console.log('【调试】calculateSteps 开始执行，目标节点ID:', targetId);
  console.log('【调试】传入的节点数组长度:', nodes.length);
  
  // Tracks navigation steps needed to reach target node
  const stepsToTake: Array<{
    nodeId: string;
    stepsLeft: number;
    stepsRight: number;
  }> = [];

  let currentNode = nodes.find((node) => node.id === targetId);
  console.log('【调试】找到的目标节点:', currentNode ? '存在' : '不存在', 
              currentNode ? `(hidden: ${currentNode.data?.hidden})` : '');
    
  if (!currentNode) {
    console.log('【调试】未找到目标节点，返回空步骤数组');
    return [];
  }

  // Navigate up the tree while nodes are hidden
  while (currentNode?.data?.hidden) {
    console.log('【调试】当前节点是隐藏的，ID:', currentNode.id);
    
    const parent = nodes.find((n) => n.id === currentNode?.parent);
    console.log('【调试】找到父节点:', parent ? '存在' : '不存在', 
                parent ? `(ID: ${parent.id}, hidden: ${parent.data?.hidden})` : '');
    
    if (!parent) {
      console.log('【调试】未找到父节点，跳出循环');
      break;
    }

    // Find indexes for current child and nearest visible sibling
    const childIndex = parent.children.indexOf(currentNode.id);
    const activeChildIndex = parent.children.findIndex(
      (childId) => nodes.find((node) => node.id === childId)?.data?.hidden === false
    );
    
    console.log('【调试】子节点索引:', childIndex, '可见兄弟节点索引:', activeChildIndex);
  
    if (parent.children.length > 1) {
      console.log('【调试】父节点有多个子节点，计算导航步骤');
      
      // If no visible siblings, navigate from first child
      if (activeChildIndex === -1) {
        console.log('【调试】没有可见的兄弟节点，从第一个子节点开始导航');
        
        for (let i = 0; i < childIndex; i++) {
          stepsToTake.push({
            nodeId: parent.children[0],
            stepsLeft: -1,
            stepsRight: 1,
          });
        }
        
        console.log('【调试】添加了', childIndex, '个导航步骤');
      } else {
        // Calculate steps needed to reach nearest visible sibling
        const moveRight = childIndex > activeChildIndex;
        const steps = Math.abs(activeChildIndex - childIndex);
        
        console.log('【调试】需要移动方向:', moveRight ? '向右' : '向左', '步数:', steps);

        for (let i = 0; i < steps; i++) {
          stepsToTake.push({
            nodeId: parent.children[activeChildIndex],
            stepsLeft: moveRight ? -1 : 1,
            stepsRight: moveRight ? 1 : -1,
          });
        }
        
        console.log('【调试】添加了', steps, '个导航步骤');
      }
    } else {
      console.log('【调试】父节点只有一个子节点，不需要计算导航步骤');
    }
    
    currentNode = parent;
    console.log('【调试】移动到父节点，ID:', currentNode.id);
  }

  console.log('【调试】导航步骤计算完成，总步骤数:', stepsToTake.length);
  console.log('【调试】最终步骤数组:', JSON.stringify(stepsToTake.reverse(), null, 2));
  
  // Return steps in bottom-up order
  return stepsToTake;
}; 