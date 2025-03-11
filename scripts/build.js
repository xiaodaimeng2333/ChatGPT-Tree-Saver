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

// Ensure viewer.html is in the dist directory
try {
  copyFileSync(
    resolve(__dirname, '../viewer.html'),
    resolve(__dirname, '../dist/viewer.html')
  );
  console.log('Copied viewer.html to dist directory');
} catch (error) {
  console.error('Error copying viewer.html:', error);
}
