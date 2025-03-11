import { copyFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Copy manifest
copyFileSync(
  resolve(__dirname, '../public/manifest.json'),
  resolve(__dirname, '../dist/manifest.json')
);

// Copy logo files
['logo16.png', 'logo48.png', 'logo128.png'].forEach(file => {
  copyFileSync(
    resolve(__dirname, '../public/' + file),
    resolve(__dirname, '../dist/' + file)
  );
});

// Copy viewer.html and viewer.js from public directory
try {
  copyFileSync(
    resolve(__dirname, '../public/viewer.html'),
    resolve(__dirname, '../dist/viewer.html')
  );
  copyFileSync(
    resolve(__dirname, '../public/viewer.js'),
    resolve(__dirname, '../dist/viewer.js')
  );
  console.log('Copied viewer files to dist directory');
} catch (error) {
  console.error('Error copying viewer files:', error);
}
