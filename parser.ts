import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { parse } from "graphql";

// Types
type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JSONValue }
  | JSONValue[];

interface RefObject {
  $ref: string;
}

interface JSONQLOptions {
  rootDir: string;
  maxDepth?: number;
  cache?: boolean;
}

class JSONQL {
  private rootDir: string;
  private maxDepth: number;
  private cache: Map<string, JSONValue>;
  private enableCache: boolean;
  private visitedRefs: Set<string>; // To prevent circular references

  constructor(options: JSONQLOptions) {
    this.rootDir = options.rootDir;
    this.maxDepth = options.maxDepth || 10;
    this.enableCache = options.cache !== false;
    this.cache = new Map<string, JSONValue>();
    this.visitedRefs = new Set<string>();
  }

  /**
   * Load a JSON file from disk
   */
  private loadJSON(
    filePath: string,
  ): Omit<JSONValue, "string" | "number" | "boolean"> {
    const absolutePath = path.resolve(
      this.rootDir,
      filePath.startsWith("/") ? filePath.slice(1) : filePath,
    );

    if (!existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    try {
      const fileContent = readFileSync(absolutePath, "utf-8");
      return JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse JSON file ${absolutePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Resolve a JSON reference
   */
  private resolveRef(ref: string, depth = 0): JSONValue {
    if (depth > this.maxDepth) {
      throw new Error(
        `Max reference depth (${this.maxDepth}) exceeded. Possible circular reference: ${ref}`,
      );
    }

    // Check if we've already visited this reference during this resolution chain
    if (this.visitedRefs.has(ref)) {
      console.log(
        `Circular reference detected: ${ref}. Returning empty object.`,
      );
      return {}; // Return empty object instead of throwing error
    }

    // Add to visited refs set
    this.visitedRefs.add(ref);

    // Check cache first
    if (this.enableCache && this.cache.has(ref)) {
      console.log(`Using cached value for ${ref}`);
      const cachedValue = this.cache.get(ref)!;
      // Remove from visited after resolution
      this.visitedRefs.delete(ref);
      return cachedValue;
    }

    console.log(`Resolving reference: ${ref}`);
    let [filePath, fragment] = ref.split("#");

    // If there's no fragment, load the whole document
    if (!fragment) {
      try {
        const result = this.loadJSON(filePath);

        if (this.enableCache) {
          this.cache.set(ref, result);
        }

        // Remove from visited after resolution
        this.visitedRefs.delete(ref);

        return result;
      } catch (error) {
        console.error(`Error loading file ${filePath}:`, error);
        this.visitedRefs.delete(ref);
        return {}; // Return empty object on error
      }
    }

    // Load the document
    let document: JSONValue;
    try {
      document = this.loadJSON(filePath);
    } catch (error) {
      console.error(`Error loading file ${filePath}:`, error);
      this.visitedRefs.delete(ref);
      return {}; // Return empty object on error
    }

    // Resolve the fragment
    const fragmentPath = fragment.startsWith("/")
      ? fragment.slice(1).split("/")
      : fragment.split("/");
    let result: JSONValue = document;

    try {
      for (const segment of fragmentPath) {
        if (typeof result !== "object" || result === null) {
          throw new Error(
            `Cannot navigate fragment path ${fragment} in ${filePath}`,
          );
        }

        result = (result as Record<string, JSONValue>)[segment];

        if (result === undefined) {
          throw new Error(`Fragment path ${fragment} not found in ${filePath}`);
        }
      }

      if (this.enableCache) {
        this.cache.set(ref, result);
      }
    } catch (error) {
      console.error(
        `Error resolving fragment ${fragment} in ${filePath}:`,
        error,
      );
      result = {}; // Return empty object on error
    }

    // Remove from visited after resolution
    this.visitedRefs.delete(ref);

    return result;
  }

  /**
   * Check if an object has a $ref property
   */
  private isRef(obj: unknown): obj is RefObject {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "$ref" in obj &&
      typeof (obj as RefObject).$ref === "string"
    );
  }

  /**
   * Resolve all references in a document
   */
  private async resolveAllRefs(
    data: JSONValue,
    selections: Record<string, any>,
    depth = 0,
  ): Promise<JSONValue> {
    if (depth > this.maxDepth) {
      throw new Error(`Max reference depth (${this.maxDepth}) exceeded.`);
    }

    // Handle primitive types
    if (typeof data !== "object" || data === null) {
      return data;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return Promise.all(
        data.map((item) => this.resolveAllRefs(item, selections, depth + 1)),
      );
    }

    // Check if this is a reference
    if (this.isRef(data)) {
      console.log(`Resolving reference: ${data.$ref}`);
      const resolved = this.resolveRef(data.$ref, depth);
      return this.resolveAllRefs(resolved, selections, depth + 1);
    }

    // Handle regular objects
    const result: Record<string, JSONValue> = {};

    // Include all keys that are in the selections
    for (const key of Object.keys(data)) {
      if (key in selections || Object.keys(selections).length === 0) {
        const value = data[key];

        // If there are sub-selections for this key, pass them along
        const subSelections = selections[key] || {};
        result[key] = await this.resolveAllRefs(
          value,
          subSelections,
          depth + 1,
        );
      }
    }

    return result;
  }

  /**
   * Extract field selections from a GraphQL query
   */
  private extractFieldSelections(query: string): Record<string, Set<string>> {
    const ast = parse(query);
    const selections: Record<string, Set<string>> = {};

    // Process selections
    for (const definition of ast.definitions) {
      if (definition.kind === "OperationDefinition") {
        for (const selection of definition.selectionSet.selections) {
          if (selection.kind === "Field") {
            const fieldName = selection.name.value;
            selections[fieldName] = new Set<string>();

            // If there are sub-selections, process them
            if (selection.selectionSet) {
              for (const subSelection of selection.selectionSet.selections) {
                if (subSelection.kind === "Field") {
                  selections[fieldName].add(subSelection.name.value);
                }
              }
            } else {
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
  private processNestedQuery(query: string): Record<string, any> {
    const ast = parse(query);
    const rootSelections: Record<string, any> = {};

    // Process top-level selections
    for (const definition of ast.definitions) {
      if (definition.kind === "OperationDefinition") {
        for (const selection of definition.selectionSet.selections) {
          if (selection.kind === "Field") {
            const fieldName = selection.name.value;
            rootSelections[fieldName] = {};

            // Process nested selections recursively
            if (selection.selectionSet) {
              this.processNestedSelections(
                selection.selectionSet,
                rootSelections[fieldName],
              );
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
  private processNestedSelections(
    selectionSet: any,
    result: Record<string, any>,
  ): void {
    for (const selection of selectionSet.selections) {
      if (selection.kind === "Field") {
        const fieldName = selection.name.value;

        if (selection.selectionSet) {
          // Create an object for nested selections
          result[fieldName] = {};
          this.processNestedSelections(
            selection.selectionSet,
            result[fieldName],
          );
        } else {
          // For leaf nodes, we use an empty object to indicate selection
          result[fieldName] = {};
        }
      }
    }

    // Debug the resulting selection object
    console.log(`Processed selections: ${JSON.stringify(Object.keys(result))}`);
  }

  /**
   * Filter response based on query selection
   */
  private filterResponse(
    data: JSONValue,
    selections: Record<string, any>,
  ): JSONValue {
    // Handle primitive types
    if (typeof data !== "object" || data === null) {
      return data;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return data.map((item) => this.filterResponse(item, selections));
    }

    const result: Record<string, JSONValue> = {};

    // For each selected field in the query
    for (const key in selections) {
      // Only include fields that exist in the data
      if (key in data) {
        const subSelections = selections[key];

        // If this field has sub-selections and the data is an object
        if (
          typeof subSelections === "object" &&
          subSelections !== null &&
          !Array.isArray(subSelections) &&
          typeof data[key] === "object" &&
          data[key] !== null
        ) {
          // Recursively filter sub-fields
          result[key] = this.filterResponse(data[key], subSelections);
        } else {
          // Include the field as-is
          result[key] = data[key];
        }
      }
    }

    return result;
  }

  /**
   * Execute a JSONQL query on a document
   */
  async query(entryFile: string, queryStr: string): Promise<JSONValue> {
    try {
      // Reset visited refs for a new query
      this.visitedRefs.clear();

      // Load the entry document
      const rootData = this.loadJSON(entryFile);

      // Parse the selections from the query
      const querySelections = this.processNestedQuery(queryStr);

      // Apply the query to the document, resolving references as needed
      const result: Record<string, JSONValue> = {};

      for (const key in querySelections) {
        if (key in rootData) {
          const selections = querySelections[key];

          // Resolve all references in this part of the document
          // Pass the full selection tree instead of just keys
          const dataWithResolvedRefs = await this.resolveAllRefs(
            rootData[key as keyof typeof rootData],
            selections,
          );

          // Filter the response to only include requested fields
          result[key] = this.filterResponse(dataWithResolvedRefs, selections);
        }
      }

      return result;
    } catch (error) {
      console.error("Error executing query:", error);
      throw error;
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
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
