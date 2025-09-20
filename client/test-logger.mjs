import { logger } from './electron/logger.js';

// 测试日志功能
console.log('Testing logger...');
logger.info('This is an info message');
logger.warn('This is a warning message');
logger.error('This is an error message');
logger.debug('This is a debug message');

console.log('Log file path:', logger.getLogFilePath());
console.log('Test completed');