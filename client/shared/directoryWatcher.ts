export interface DirectoryWatchImportRequest {
  taskId: string;
  filePath: string;
}

export type DirectoryWatchStatusMessage =
  | {
      status: "accepted";
      taskId: string;
      filePath: string;
    }
  | {
      status: "busy";
      taskId: string;
      filePath?: string;
    }
  | {
      status: "progress";
      taskId: string;
      step: string;
      state: "start" | "success" | "error";
      message?: string;
      filePath?: string;
    }
  | {
      status: "idle";
      taskId: string;
      result: "success" | "error" | "cancelled";
      filePath?: string;
      error?: string;
      message?: string;
    }
  | {
      status: "error";
      taskId: string;
      filePath?: string;
      error: string;
    };
