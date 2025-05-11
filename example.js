// Example 1: Basic query with references
const query1 = `{ books { title author { name } } }`;

// This would return:
const result1 = {
  books: [
    {
      title: "The Great Gatsby",
      author: {
        name: "F. Scott Fitzgerald",
      },
    },
    {
      title: "1984",
      author: {
        name: "George Orwell",
      },
    },
  ],
};

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

// This would resolve all the references and return:
const result2 = {
  books: [
    {
      title: "The Great Gatsby",
      author: {
        name: "F. Scott Fitzgerald",
        birthYear: 1896,
        books: [
          { title: "The Great Gatsby" },
          { title: "Tender Is the Night" },
        ],
      },
      publisher: {
        name: "Charles Scribner's Sons",
        location: "New York",
      },
    },
    {
      title: "1984",
      author: {
        name: "George Orwell",
        birthYear: 1903,
        books: [{ title: "1984" }, { title: "Animal Farm" }],
      },
      publisher: {
        name: "Secker & Warburg",
        location: "London",
      },
    },
  ],
};
