import { render } from 'preact';
import { App } from './app';
import { logoSvgString } from './components/logo';

// Set favicon to the dog logo
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = `data:image/svg+xml,${encodeURIComponent(logoSvgString)}`;
document.head.appendChild(favicon);

render(<App />, document.getElementById('app')!);
