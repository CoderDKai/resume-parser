import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs/promises';
import * as path from 'path';

// 定义输入输出类型
interface PDFMergeOptions {
  inputDir: string;    // 输入PDF文件夹路径
  outputDir: string;   // 输出PDF文件夹路径
}

/**
 * 获取目录下所有PDF文件
 * @param dirPath 目录路径
 * @returns Promise<string[]> PDF文件路径数组
 */
async function getPDFFiles(dirPath: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dirPath);
    return files
      .filter(file => file.toLowerCase().endsWith('.pdf'))
      .map(file => path.join(dirPath, file));
  } catch (error) {
    console.error('读取目录失败:', error);
    throw error;
  }
}

/**
 * 合并指定目录下的PDF文件
 * @param options 输入和输出选项
 * @returns Promise<void>
 */
async function mergePDFs(options: PDFMergeOptions): Promise<void> {
  try {
    // 获取输入目录下的所有PDF文件
    const pdfFiles = await getPDFFiles(options.inputDir);
    
    if (pdfFiles.length === 0) {
      console.log('目录中没有找到PDF文件');
      return;
    }

    // 创建一个新的PDF文档作为结果
    const mergedPdf = await PDFDocument.create();

    // 遍历所有PDF文件
    for (const pdfPath of pdfFiles) {
      // 读取PDF文件内容
      const pdfBytes = await fs.readFile(pdfPath);
      // 加载PDF文档
      const pdfDoc = await PDFDocument.load(pdfBytes);
      // 获取所有页面
      const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
      // 将页面添加到合并文档中
      pages.forEach(page => mergedPdf.addPage(page));
    }

    // 使用输入目录名作为输出文件名
    const dirName = path.basename(options.inputDir);
    const outputPath = path.join(options.outputDir, `${dirName}.pdf`);

    // 确保输出目录存在
    await fs.mkdir(options.outputDir, { recursive: true });

    // 保存合并后的PDF
    const mergedPdfBytes = await mergedPdf.save();
    await fs.writeFile(outputPath, mergedPdfBytes);

    console.log(`PDF合并完成，已保存到: ${outputPath}`);
  } catch (error) {
    console.error('PDF合并失败:', error);
    throw error;
  }
}

// 使用示例
async function main() {
  const options: PDFMergeOptions = {
    inputDir: './attachments',
    outputDir: './merged'
  };

  try {
    await mergePDFs(options);
  } catch (error) {
    console.error('合并过程出错:', error);
  }
}

// 运行示例
main();