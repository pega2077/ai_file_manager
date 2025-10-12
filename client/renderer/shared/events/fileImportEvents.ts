export const FILE_IMPORT_NOTIFICATION_EVENT = 'file-import-notification';

export type FileImportStep =
  | 'stage-file'
  | 'list-directory'
  | 'describe-image'
  | 'recommend-directory'
  | 'await-confirmation'
  | 'save-file'
  | 'import-rag';

export type FileImportStepState = 'start' | 'success' | 'error';

export type FileImportNotification =
  | {
      status: 'start';
      taskId: string;
      filePath?: string;
      filename?: string;
    }
  | {
      status: 'progress';
      taskId: string;
      step: FileImportStep;
      state: FileImportStepState;
      message?: string;
    }
  | {
      status: 'success';
      taskId: string;
      message?: string;
    }
  | {
      status: 'error';
      taskId: string;
      error: string;
      message?: string;
    }
  | {
      status: 'cancelled';
      taskId: string;
      message?: string;
    };

export const dispatchFileImportNotification = (
  detail: FileImportNotification,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  if (window.electronAPI?.sendFileImportNotification) {
    window.electronAPI.sendFileImportNotification(detail);
    return;
  }

  window.dispatchEvent(
    new CustomEvent<FileImportNotification>(FILE_IMPORT_NOTIFICATION_EVENT, {
      detail,
    }),
  );
};

export type FileImportNotificationListener = (
  notification: FileImportNotification,
) => void;

export const subscribeFileImportNotifications = (
  listener: FileImportNotificationListener,
): (() => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  if (window.electronAPI?.onFileImportNotification) {
    return window.electronAPI.onFileImportNotification(listener);
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<FileImportNotification>).detail;
    if (detail) {
      listener(detail);
    }
  };

  window.addEventListener(
    FILE_IMPORT_NOTIFICATION_EVENT,
    handler as EventListener,
  );

  return () => {
    window.removeEventListener(
      FILE_IMPORT_NOTIFICATION_EVENT,
      handler as EventListener,
    );
  };
};
