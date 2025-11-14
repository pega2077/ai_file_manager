declare module "archiver" {
  import type { Writable } from "stream";

  export interface ZipOptions {
    zlib?: {
      level?: number;
    };
  }

  export interface EntryData {
    name?: string;
    prefix?: string;
    stats?: import("fs").Stats;
  }

  export interface Archiver {
    on(event: "error", listener: (error: Error) => void): this;
    pipe(stream: Writable): Writable;
    file(filepath: string, data?: EntryData): this;
    finalize(): Promise<void>;
  }

  export type ArchiverCreator = (format: string, options?: ZipOptions) => Archiver;

  const createArchiver: ArchiverCreator;
  export default createArchiver;
}
