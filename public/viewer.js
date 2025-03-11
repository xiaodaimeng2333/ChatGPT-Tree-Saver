document.addEventListener('DOMContentLoaded', function() {
  const fileInput = document.getElementById('file-input');
  const importBtn = document.getElementById('import-btn');
  const dropzone = document.getElementById('dropzone');
  const treeContainer = document.getElementById('tree-container');

  // 处理文件选择
  importBtn.addEventListener('click', function(e) {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', function(e) {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  // 处理拖放
  dropzone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropzone.classList.add('active');
  });

  dropzone.addEventListener('dragleave', function() {
    dropzone.classList.remove('active');
  });

  dropzone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropzone.classList.remove('active');
    
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  // 处理文件
  function handleFile(file) {
    // 检查文件扩展名而不是MIME类型
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.json')) {
      alert('请上传JSON文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        displayTree(data);
      } catch (error) {
        alert('无法解析JSON文件: ' + error.message);
      }
    };
    reader.onerror = function(error) {
      console.error('读取文件出错:', error);
      alert('读取文件时发生错误');
    };
    reader.readAsText(file);
  }

  // 显示树
  function displayTree(data) {
    dropzone.classList.add('hidden');
    treeContainer.classList.remove('hidden');
    
    // 这里可以添加代码来可视化对话树
    // 简单起见，我们先显示JSON数据的字符串表示
    treeContainer.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
  }
}); 