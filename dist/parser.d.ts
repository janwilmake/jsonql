type JSONValue = string | number | boolean | null | {
    [key: string]: JSONValue;
} | JSONValue[];
interface JSONQLOptions {
    rootDir: string;
    maxDepth?: number;
    cache?: boolean;
}
declare class JSONQL {
    private rootDir;
    private maxDepth;
    private cache;
    private enableCache;
    private visitedRefs;
    constructor(options: JSONQLOptions);
    /**
     * Load a JSON file from disk
     */
    private loadJSON;
    /**
     * Resolve a JSON reference
     */
    private resolveRef;
    /**
     * Check if an object has a $ref property
     */
    private isRef;
    /**
     * Resolve all references in a document
     */
    private resolveAllRefs;
    /**
     * Extract field selections from a GraphQL query
     */
    private extractFieldSelections;
    /**
     * Process a nested query - extract deep field selections
     */
    private processNestedQuery;
    /**
     * Process nested selections in query
     */
    private processNestedSelections;
    /**
     * Filter response based on query selection
     */
    private filterResponse;
    /**
     * Execute a JSONQL query on a document
     */
    query(entryFile: string, queryStr: string): Promise<JSONValue>;
    /**
     * Clear the cache
     */
    clearCache(): void;
}
export { JSONQL };
