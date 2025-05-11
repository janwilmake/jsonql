import { JSONQL } from "./parser";
// Create a new JSONQL instance
const jsonql = new JSONQL({
    rootDir: "./", // Root directory for file resolution
    maxDepth: 10, // Maximum depth for reference resolution
    cache: true, // Enable caching for better performance
});
// Basic query with references
const query1 = `{ books { title author { name } } }`;
console.log("Executing Basic Query:");
console.log(query1);
console.log("-------------------");
jsonql
    .query("/books.json", query1)
    .then((result) => {
    console.log("Result:");
    console.log(JSON.stringify(result, null, 2));
    console.log("\n");
    // Clear cache between queries
    jsonql.clearCache();
    // Deeper nested query
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
    console.log("Executing Nested Query:");
    console.log(query2);
    console.log("-------------------");
    return jsonql.query("/books.json", query2);
})
    .then((result) => {
    console.log("Result:");
    console.log(JSON.stringify(result, null, 2));
})
    .catch((err) => console.error("Query error:", err));
