import { copyFileSync, readFileSync, writeFileSync, readdirSync } from 'fs';
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

// Process viewer.html
try {
  // Read the built viewer.html
  const viewerHtmlPath = resolve(__dirname, '../dist/viewer.html');
  let viewerHtml = readFileSync(viewerHtmlPath, 'utf8');

  // Find all relevant files in dist directory
  const distFiles = readdirSync(resolve(__dirname, '../dist'));
  const viewerScript = distFiles.find(file => file.startsWith('viewer-') && file.endsWith('.js'));
  const indexScript = distFiles.find(file => file.startsWith('index-') && file.endsWith('.js'));
  const viewerCss = distFiles.find(file => file.startsWith('viewer-') && file.endsWith('.css'));

  if (!viewerScript || !indexScript || !viewerCss) {
    throw new Error('Could not find required files in dist directory');
  }

  // Update all resource paths to be relative
  viewerHtml = viewerHtml
    .replace(/href="\/([^"]+)"/g, 'href="./$1"')
    .replace(/src="\/([^"]+)"/g, 'src="./$1"')
    .replace(/href="([^"./][^"]+)"/g, 'href="./$1"')
    .replace(/src="([^"./][^"]+)"/g, 'src="./$1"');

  // Write the updated viewer.html
  writeFileSync(viewerHtmlPath, viewerHtml);
  console.log('Updated viewer.html with correct resource paths');
} catch (error) {
  console.error('Error processing viewer files:', error);
}
