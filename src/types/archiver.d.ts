declare module 'archiver' {
  interface ArchiverOptions {
    zlib?: {
      level?: number;
    };
  }

  interface Archiver {
    pipe(destination: any): void;
    on(event: string, listener: (...args: any[]) => void): Archiver;
    append(source: any, data: any): Archiver;
    finalize(): Promise<void>;
    destroy(): void;
  }

  function archiver(format: string, options?: ArchiverOptions): Archiver;

  export = archiver;
}
