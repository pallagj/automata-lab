// Generated from openapi.json by `npm run gen` — do not edit.

export interface paths {
    "/api/snapshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Share a worksheet
         * @description Stores an unchangeable copy of the worksheet and returns its short link. Later edits of the original do not reach the link.
         */
        post: operations["shareWorksheet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/snapshots/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Open a shared worksheet */
        get: operations["openSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Is the service up */
        get: operations["health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        SharedLink: {
            /**
             * @description Ten letters and digits: the end of a share link.
             * @example k3x9pq2mzt
             */
            id: string;
            /**
             * Format: uri
             * @example https://automatalab.app/w/k3x9pq2mzt
             */
            url: string;
        };
        Error: {
            error: {
                /** @enum {string} */
                code: "invalid" | "too_large" | "newer_version" | "not_found" | "rate_limited" | "storage_full" | "internal";
                message: string;
            };
        };
        Worksheet: {
            /**
             * @description The save version the worksheet was written at; an older one is brought up to date when it is read.
             * @example 1
             */
            version: number;
            name: string;
            cells: components["schemas"]["WorksheetCell"][];
        };
        WorksheetCell: {
            /** @description The cell as it is written in the editor. */
            source: string;
            /** @description The graph positions pinned by hand: state name → coordinate. */
            layout?: {
                [key: string]: {
                    x: number;
                    y: number;
                };
            };
        };
        Snapshot: {
            /**
             * @description Ten letters and digits: the end of a share link.
             * @example k3x9pq2mzt
             */
            id: string;
            /** Format: uri */
            url: string;
            /** Format: date-time */
            createdAt: string;
            worksheet: components["schemas"]["Worksheet"] & unknown;
        };
        Health: {
            /** @enum {boolean} */
            ok: true;
            saveVersion: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    shareWorksheet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The worksheet as it is now */
        requestBody: {
            content: {
                "application/json": components["schemas"]["Worksheet"];
            };
        };
        responses: {
            /** @description The worksheet is stored; anyone with the link can open it */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SharedLink"];
                };
            };
            /** @description Not a worksheet, or one over the limits */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description The request is too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description The worksheet was written by a newer version of the app */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Too many worksheets shared from this address; try again later */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description No room for new worksheets now; the links made still work */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    openSnapshot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Ten letters and digits: the end of a share link. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The shared worksheet */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Snapshot"];
                };
            };
            /** @description Not a share link's id */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description No worksheet was shared with this id */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The service answers */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
}
