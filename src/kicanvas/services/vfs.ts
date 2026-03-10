/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { initiate_download } from "../../base/dom/download";
import { basename } from "../../base/paths";

/**
 * Virtual file system abstract class.
 *
 * This is the interface used by <kc-kicanvas-shell> to find and load files.
 * It's implemented using Drag and Drop and GitHub to provide a common interface
 * for interacting and loading files.
 */
export abstract class VirtualFileSystem {
    public abstract list(): Generator<string>;
    public abstract get(name: string): Promise<File>;
    public abstract has(name: string): Promise<boolean>;
    public abstract download(name: string): Promise<void>;

    public *list_matches(r: RegExp) {
        for (const filename of this.list()) {
            if (filename.match(r)) {
                yield filename;
            }
        }
    }

    public *list_ext(ext: string) {
        if (!ext.startsWith(".")) {
            ext = `.${ext}`;
        }

        for (const filename of this.list()) {
            if (filename.endsWith(ext)) {
                yield filename;
            }
        }
    }
}

/**
 * Virtual file system for URLs via Fetch
 */
export class FetchFileSystem extends VirtualFileSystem {
    private urls: Map<string, URL> = new Map();
    private resolver!: (name: string) => URL;

    #default_resolver(name: string): URL {
        const url = new URL(name, window.location.toString());
        return url;
    }

    #resolve(filepath: string | URL): URL {
        if (typeof filepath === "string") {
            const cached_url = this.urls.get(filepath);
            if (cached_url) {
                return cached_url;
            } else {
                const url = this.resolver(filepath);
                const name = basename(url);
                this.urls.set(name, url);
                return url;
            }
        }
        return filepath;
    }

    constructor(
        urls: (string | URL)[],
        resolve_file: ((name: string) => URL) | null = null,
    ) {
        super();

        this.resolver = resolve_file ?? this.#default_resolver;

        for (const item of urls) {
            this.#resolve(item);
        }
    }

    public override *list() {
        yield* this.urls.keys();
    }

    public override async has(name: string) {
        return Promise.resolve(this.urls.has(name));
    }

    public override async get(name: string): Promise<File> {
        const url = this.#resolve(name);

        if (!url) {
            throw new Error(`File ${name} not found!`);
        }

        const request = new Request(url, { method: "GET" });
        const response = await fetch(request);

        if (!response.ok) {
            throw new Error(
                `Unable to load ${url}: ${response.status} ${response.statusText}`,
            );
        }

        const blob = await response.blob();

        return new File([blob], name);
    }

    public async download(name: string) {
        initiate_download(await this.get(name));
    }
}

/**
 * Virtual file system for HTML drag and drop (DataTransfer)
 */
export class DragAndDropFileSystem extends VirtualFileSystem {
    constructor(private items: Map<string, FileSystemFileEntry>) {
        super();
    }

    static async fromDataTransfer(dt: DataTransfer) {
        const entries: FileSystemEntry[] = [];

        for (let i = 0; i < dt.items.length; i++) {
            const item = dt.items[i]?.webkitGetAsEntry();
            if (item) {
                entries.push(item);
            }
        }

        const items = new Map<string, FileSystemFileEntry>();

        // If a single directory, read it recursively with relative paths.
        if (entries.length == 1 && entries[0]?.isDirectory) {
            await this.readDirectoryRecursive(
                entries[0] as FileSystemDirectoryEntry,
                entries[0].fullPath,
                items,
            );
        } else {
            for (const entry of entries) {
                if (entry.isFile) {
                    items.set(entry.name, entry as FileSystemFileEntry);
                } else if (entry.isDirectory) {
                    const parentPath = entry.fullPath.replace(/\/[^/]+$/, "");
                    await this.readDirectoryRecursive(
                        entry as FileSystemDirectoryEntry,
                        parentPath,
                        items,
                    );
                }
            }
        }

        return new DragAndDropFileSystem(items);
    }

    private static async readDirectoryRecursive(
        dir: FileSystemDirectoryEntry,
        rootPath: string,
        results: Map<string, FileSystemFileEntry>,
    ) {
        const reader = dir.createReader();

        // readEntries returns results in batches per spec.
        let batch: FileSystemEntry[];
        do {
            batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
                reader.readEntries(
                    (entries) => resolve(Array.from(entries)),
                    reject,
                );
            });

            for (const entry of batch) {
                if (entry.isFile) {
                    let relativePath = entry.fullPath;
                    const prefix = rootPath + "/";
                    if (relativePath.startsWith(prefix)) {
                        relativePath = relativePath.slice(prefix.length);
                    }
                    results.set(relativePath, entry as FileSystemFileEntry);
                } else if (entry.isDirectory) {
                    await this.readDirectoryRecursive(
                        entry as FileSystemDirectoryEntry,
                        rootPath,
                        results,
                    );
                }
            }
        } while (batch.length > 0);
    }

    public override *list() {
        yield* this.items.keys();
    }

    public override async has(name: string): Promise<boolean> {
        return this.items.has(name);
    }

    public override async get(name: string): Promise<File> {
        const file_entry = this.items.get(name);

        if (!file_entry) {
            throw new Error(`File ${name} not found!`);
        }

        return await new Promise((resolve, reject) => {
            file_entry.file(resolve, reject);
        });
    }

    public async download(name: string) {
        initiate_download(await this.get(name));
    }
}

/**
 * Virtual file system for local files
 */
export class LocalFileSystem extends VirtualFileSystem {
    constructor(private files: File[]) {
        super();
    }

    override *list() {
        for (const entry of this.files) {
            yield entry.name;
        }
    }

    override async has(name: string): Promise<boolean> {
        return this.files.find((f) => f.name == name) !== undefined;
    }

    override async get(name: string): Promise<File> {
        const file = this.files.find((f) => f.name == name);
        if (file) {
            return file;
        } else {
            throw new Error(`File ${name} not found`);
        }
    }

    override async download(name: string) {
        initiate_download(await this.get(name));
    }
}

/**
 * Merge two virtual file systems into one
 */
export class MergedFileSystem extends VirtualFileSystem {
    private fs_list: VirtualFileSystem[];

    constructor(fs: (VirtualFileSystem | null)[]) {
        super();
        this.fs_list = fs.filter((f) => f !== null);
    }

    override *list() {
        for (const fs of this.fs_list) {
            yield* fs.list();
        }
    }

    override async has(name: string): Promise<boolean> {
        for (const fs of this.fs_list) {
            if (await fs.has(name)) {
                return true;
            }
        }

        return false;
    }

    override async get(name: string): Promise<File> {
        for (const fs of this.fs_list) {
            if (await fs.has(name)) {
                return await fs.get(name);
            }
        }

        throw new Error(`File ${name} not found`);
    }

    override async download(name: string) {
        for (const fs of this.fs_list) {
            if (await fs.has(name)) {
                return await fs.download(name);
            }
        }

        throw new Error(`File ${name} not found`);
    }
}
