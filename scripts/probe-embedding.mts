const { embeddingProvider } = await import("../server/core/embeddings.ts");
console.log("embedding-provider", embeddingProvider.name);
const vector = await embeddingProvider.embed("The experiment included 30 participants.");
console.log("dimensions", vector.length);
