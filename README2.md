# JSONQL

A GraphQL-inspired query language for JSON documents with reference support.

## Concept

JSONQL lets you use GraphQL query syntax to fetch partial JSON from documents that may contain references to other JSON documents. The system:

1. Uses standard JSON with a `$ref` property that points to other JSON documents
2. Uses JSON Schema (`$schema`) for type definitions
3. Uses GraphQL's query syntax to specify which data to retrieve
4. Automatically resolves references as needed

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/jsonql.git
cd jsonql

# Install dependencies
bun install

# Build the project
bun run build
```

## Usage

### Basic Example

```typescript
import { queryJson } from "jsonql";

// Simple query
const result = await queryJson(
  "{ books { title author { name } } }",
  "/books.json",
  "./data",
);

console.log(JSON.stringify(result, null, 2));
```

### Command Line Interface

```bash
# Run a query directly
bun run src/cli.ts --query "{ books { title } }" ./data/books.json

# Run a query from a file
bun run src/cli.ts --query-file ./query.graphql ./data/books.json

# Specify a base path for resolving references
bun run src/cli.ts --query "{ books { title } }" --base-path ./data ./books.json
```

## Data Format

### Document with References

```json
{
  "$schema": "./schemas/books.schema.json",
  "books": [
    {
      "id": "book1",
      "title": "The Great Gatsby",
      "author": {
        "$ref": "/authors/author1.json"
      },
      "publisher": {
        "$ref": "/publishers/pub1.json"
      },
      "genres": ["Fiction", "Classic"]
    }
  ]
}
```

### JSON Schema Example

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "books": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "author": {
            "type": "object",
            "properties": {
              "$ref": { "type": "string" }
            }
          },
          "genres": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    }
  }
}
```

## Features

- **GraphQL Query Syntax**: Use the familiar GraphQL query language
- **Reference Resolution**: Automatically resolves `$ref` links across documents
- **JSON Schema Support**: Validate documents against their schemas
- **Caching**: Optional caching of documents for performance
- **Path Navigation**: Support for JSON path fragments like `#/books/0`
- **TypeScript Support**: Fully typed for developer experience

## API Reference

### `JsonQLParser`

```typescript
import { JsonQLParser } from "jsonql";

const parser = new JsonQLParser({
  basePath: "./data", // Base path for resolving documents
  cache: true, // Enable document caching (default: true)
});

// Execute a query against a document
const result = await parser.executeQuery(query, documentPath);

// Clear the document cache
parser.clearCache();
```

### `queryJson` Helper

```typescript
import { queryJson } from "jsonql";

// Simple wrapper around JsonQLParser
const result = await queryJson(query, documentPath, basePath);
```

## Development

```bash
# Run tests
bun test

# Type check
bun run check

# Build for production
bun run build
```

## License

MIT
