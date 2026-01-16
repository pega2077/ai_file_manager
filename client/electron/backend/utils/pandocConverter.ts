import { spawn } from "child_process";
import { promises as fsp } from "fs";
import path from "path";
import { logger } from "../../logger";
import { configManager } from "../../configManager";
import { ensureTempDir } from "./pathHelper";

/**
 * Check if pandoc is available at the specified path or in system PATH
 */
export async function checkPandocAvailable(pandocPath?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd = pandocPath || "pandoc";
    const proc = spawn(cmd, ["--version"], { shell: true });
    
    let hasOutput = false;
    proc.stdout.on("data", () => {
      hasOutput = true;
    });
    
    proc.on("error", () => {
      resolve(false);
    });
    
    proc.on("close", (code) => {
      resolve(code === 0 && hasOutput);
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Get list of supported formats from pandoc
 */
export async function getPandocFormats(pandocPath?: string): Promise<{ inputs: string[]; outputs: string[] }> {
  const cmd = pandocPath || "pandoc";
  
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, ["--list-input-formats"], { shell: true });
    
    let stdout = "";
    let stderr = "";
    
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    proc.on("error", (err) => {
      reject(err);
    });
    
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pandoc --list-input-formats failed: ${stderr}`));
        return;
      }
      
      const inputs = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      
      // Get output formats
      const procOut = spawn(cmd, ["--list-output-formats"], { shell: true });
      let stdoutOut = "";
      let stderrOut = "";
      
      procOut.stdout.on("data", (data) => {
        stdoutOut += data.toString();
      });
      
      procOut.stderr.on("data", (data) => {
        stderrOut += data.toString();
      });
      
      procOut.on("error", (err) => {
        reject(err);
      });
      
      procOut.on("close", (codeOut) => {
        if (codeOut !== 0) {
          reject(new Error(`pandoc --list-output-formats failed: ${stderrOut}`));
          return;
        }
        
        const outputs = stdoutOut
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        
        resolve({ inputs, outputs });
      });
    });
  });
}

/**
 * Convert a file using local pandoc
 */
export async function convertFileWithPandoc(
  filePath: string,
  sourceFormat: string,
  targetFormat: string,
  pandocPath?: string
): Promise<string> {
  const cmd = pandocPath || "pandoc";
  
  // Determine output extension
  const outExt = targetFormat === "markdown" ? "md" : targetFormat;
  
  // Create output path in temp directory
  const tempDir = await ensureTempDir();
  const baseName = path.basename(filePath, path.extname(filePath));
  const outputPath = path.join(tempDir, `${baseName}_${Date.now()}.${outExt}`);
  
  // Build pandoc command
  const args = [
    "-f", sourceFormat,
    "-t", targetFormat,
    "-o", outputPath,
    filePath
  ];
  
  logger.info("Converting file with pandoc", { 
    filePath, 
    sourceFormat, 
    targetFormat, 
    outputPath,
    cmd,
    args 
  });
  
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: true });
    
    let stderr = "";
    
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    proc.on("error", (err) => {
      logger.error("Pandoc process error", { err, filePath });
      reject(err);
    });
    
    proc.on("close", async (code) => {
      if (code !== 0) {
        const error = new Error(`Pandoc conversion failed: ${stderr}`);
        logger.error("Pandoc conversion failed", { code, stderr, filePath });
        reject(error);
        return;
      }
      
      // Verify output file exists
      try {
        await fsp.access(outputPath);
        logger.info("Pandoc conversion successful", { outputPath });
        resolve(outputPath);
      } catch (err) {
        logger.error("Output file not found after conversion", { outputPath });
        reject(new Error("Pandoc conversion completed but output file not found"));
      }
    });
  });
}

/**
 * Map common format names to pandoc format identifiers
 */
export function mapToPandocFormat(fmt: string): string {
  const f = (fmt || "").toLowerCase();
  const map: Record<string, string> = {
    md: "markdown",
    markdown: "markdown",
    txt: "plain",
    htm: "html",
    html: "html",
    xhtml: "html",
    doc: "doc",
    docx: "docx",
    odt: "odt",
    rtf: "rtf",
    pdf: "pdf",
    epub: "epub",
    latex: "latex",
    tex: "latex",
    rst: "rst",
    org: "org",
    mediawiki: "mediawiki",
    textile: "textile",
    asciidoc: "asciidoc",
    json: "json",
  };
  return map[f] || f;
}
