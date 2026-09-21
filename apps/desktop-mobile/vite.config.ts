import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 1420, strictPort: true }, build: { rollupOptions: { output: { manualChunks: { editor: ["@codemirror/view", "@codemirror/state", "@codemirror/commands", "@codemirror/lang-markdown", "@codemirror/language"], markdown: ["react-markdown", "remark-gfm"], cytoscape: ["cytoscape"] } } } }, clearScreen: false });
