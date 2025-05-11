import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { parse } from "graphql";
class JSONQL {
    rootDir;
    maxDepth;
    cache;
    enableCache;
    visitedRefs; // To prevent circular references
    constructor(options) {
        this.rootDir = options.rootDir;
        this.maxDepth = options.maxDepth || 10;
        this.enableCache = options.cache !== false;
        this.cache = new Map();
        this.visitedRefs = new Set();
    }
    /**
     * Load a JSON file from disk
     */
    loadJSON(filePath) {
        const absolutePath = path.resolve(this.rootDir, filePath.startsWith("/") ? filePath.slice(1) : filePath);
        if (!existsSync(absolutePath)) {
            throw new Error(`File not found: ${absolutePath}`);
        }
        try {
            const fileContent = readFileSync(absolutePath, "utf-8");
            return JSON.parse(fileContent);
        }
        catch (error) {
            throw new Error(`Failed to parse JSON file ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Resolve a JSON reference
     */
    resolveRef(ref, depth = 0) {
        if (depth > this.maxDepth) {
            throw new Error(`Max reference depth (${this.maxDepth}) exceeded. Possible circular reference: ${ref}`);
        }
        // Check if we've already visited this reference during this resolution chain
        if (this.visitedRefs.has(ref)) {
            throw new Error(`Circular reference detected: ${ref}`);
        }
        // Add to visited refs set
        this.visitedRefs.add(ref);
        // Check cache first
        if (this.enableCache && this.cache.has(ref)) {
            return this.cache.get(ref);
        }
        let [filePath, fragment] = ref.split("#");
        // If there's no fragment, load the whole document
        if (!fragment) {
            const result = this.loadJSON(filePath);
            if (this.enableCache) {
                this.cache.set(ref, result);
            }
            // Remove from visited after resolution
            this.visitedRefs.delete(ref);
            return result;
        }
        // Load the document
        const document = this.loadJSON(filePath);
        // Resolve the fragment
        const fragmentPath = fragment.startsWith("/")
            ? fragment.slice(1).split("/")
            : fragment.split("/");
        let result = document;
        for (const segment of fragmentPath) {
            if (typeof result !== "object" || result === null) {
                throw new Error(`Cannot navigate fragment path ${fragment} in ${filePath}`);
            }
            result = result[segment];
            if (result === undefined) {
                throw new Error(`Fragment path ${fragment} not found in ${filePath}`);
            }
        }
        if (this.enableCache) {
            this.cache.set(ref, result);
        }
        // Remove from visited after resolution
        this.visitedRefs.delete(ref);
        return result;
    }
    /**
     * Check if an object has a $ref property
     */
    isRef(obj) {
        return (typeof obj === "object" &&
            obj !== null &&
            "$ref" in obj &&
            typeof obj.$ref === "string");
    }
    /**
     * Resolve all references in a document
     */
    async resolveAllRefs(data, fields, depth = 0) {
        if (depth > this.maxDepth) {
            throw new Error(`Max reference depth (${this.maxDepth}) exceeded.`);
        }
        // Handle primitive types
        if (typeof data !== "object" || data === null) {
            return data;
        }
        // Handle arrays
        if (Array.isArray(data)) {
            return Promise.all(data.map((item) => this.resolveAllRefs(item, fields, depth + 1)));
        }
        // Check if this is a reference
        if (this.isRef(data)) {
            const resolved = this.resolveRef(data.$ref, depth);
            return this.resolveAllRefs(resolved, fields, depth + 1);
        }
        // Handle regular objects
        const result = {};
        for (const key of Object.keys(data)) {
            // Only include fields that are in the query
            if (fields.has(key) || fields.has("*")) {
                const value = data[key];
                result[key] = await this.resolveAllRefs(value, fields, depth + 1);
            }
        }
        return result;
    }
    /**
     * Extract field selections from a GraphQL query
     */
    extractFieldSelections(query) {
        const ast = parse(query);
        const selections = {};
        // Process selections
        for (const definition of ast.definitions) {
            if (definition.kind === "OperationDefinition") {
                for (const selection of definition.selectionSet.selections) {
                    if (selection.kind === "Field") {
                        const fieldName = selection.name.value;
                        selections[fieldName] = new Set();
                        // If there are sub-selections, process them
                        if (selection.selectionSet) {
                            for (const subSelection of selection.selectionSet.selections) {
                                if (subSelection.kind === "Field") {
                                    selections[fieldName].add(subSelection.name.value);
                                }
                            }
                        }
                        else {
                            // If no sub-selections, we want all fields
                            selections[fieldName].add("*");
                        }
                    }
                }
            }
        }
        return selections;
    }
    /**
     * Process a nested query - extract deep field selections
     */
    processNestedQuery(query) {
        const ast = parse(query);
        const rootSelections = {};
        // Process top-level selections
        for (const definition of ast.definitions) {
            if (definition.kind === "OperationDefinition") {
                for (const selection of definition.selectionSet.selections) {
                    if (selection.kind === "Field") {
                        const fieldName = selection.name.value;
                        rootSelections[fieldName] = {};
                        // Process nested selections recursively
                        if (selection.selectionSet) {
                            this.processNestedSelections(selection.selectionSet, rootSelections[fieldName]);
                        }
                    }
                }
            }
        }
        return rootSelections;
    }
    /**
     * Process nested selections in query
     */
    processNestedSelections(selectionSet, result) {
        for (const selection of selectionSet.selections) {
            if (selection.kind === "Field") {
                const fieldName = selection.name.value;
                if (selection.selectionSet) {
                    result[fieldName] = {};
                    this.processNestedSelections(selection.selectionSet, result[fieldName]);
                }
                else {
                    result[fieldName] = true;
                }
            }
        }
    }
    /**
     * Filter response based on query selection
     */
    filterResponse(data, selections) {
        if (typeof data !== "object" || data === null) {
            return data;
        }
        if (Array.isArray(data)) {
            return data.map((item) => this.filterResponse(item, selections));
        }
        const result = {};
        for (const key in selections) {
            if (key in data) {
                const subSelections = selections[key];
                if (typeof subSelections === "object" &&
                    subSelections !== null &&
                    !Array.isArray(subSelections)) {
                    result[key] = this.filterResponse(data[key], subSelections);
                }
                else {
                    result[key] = data[key];
                }
            }
        }
        return result;
    }
    /**
     * Execute a JSONQL query on a document
     */
    async query(entryFile, queryStr) {
        try {
            // Reset visited refs for a new query
            this.visitedRefs.clear();
            // Load the entry document
            const rootData = this.loadJSON(entryFile);
            // Parse the selections from the query
            const querySelections = this.processNestedQuery(queryStr);
            // Apply the query to the document, resolving references as needed
            const result = {};
            for (const key in querySelections) {
                if (key in rootData) {
                    const selections = querySelections[key];
                    // Resolve all references in this part of the document
                    const dataWithResolvedRefs = await this.resolveAllRefs(rootData[key], new Set(Object.keys(selections)));
                    // Filter the response to only include requested fields
                    result[key] = this.filterResponse(dataWithResolvedRefs, selections);
                }
            }
            return result;
        }
        catch (error) {
            console.error("Error executing query:", error);
            throw error;
        }
    }
    /**
     * Clear the cache
     */
    clearCache() {
        this.cache.clear();
    }
}
export { JSONQL };
// Example usage:
/*
const jsonql = new JSONQL({ rootDir: './' });

// Example 1: Basic query with references
const query1 = `{ books { title author { name } } }`;
jsonql.query('/books.json', query1)
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(err => console.error('Query error:', err));

// Example 2: Deeper nested query
const query2 = `{
  books {
    title
    author {
      name
      birthYear
      books {
        title
      }
    }
    publisher {
      name
      location
    }
  }
}`;

jsonql.query('/books.json', query2)
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(err => console.error('Query error:', err));
*/
