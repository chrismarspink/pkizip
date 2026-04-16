/**
 * App version — package.json에서 직접 읽어옴 (Vite가 JSON import 지원)
 */
import pkg from '../package.json';

export const APP_VERSION = pkg.version;
