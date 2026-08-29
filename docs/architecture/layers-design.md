# Architecture: Layer System

This document describes the design of the drawing layer system in Mamaco Notes.

## 1. Data Model
Drawing content is organized into a hierarchy:
- **Notebook**: A collection of pages.
- **Page**: Contains its own settings (width, height, background) and a collection of **Layers**.
- **Layer**: Contains strokes, images, and text elements.

## 2. Rendering Order (Z-Order)
Layers are stored in an array within the `Page` object:
- **Index 0**: The bottom-most layer (rendered first).
- **Last Index**: The top-most layer (rendered last).
Inside each layer, the rendering order is: **Images -> Texts -> Strokes**.

## 3. Layer Properties
Each layer has the following properties:
- `visible` (boolean): Controls whether the layer is rendered.
- `opacity` (number, 0-1): Controls the transparency of all content in the layer.
- `locked` (boolean): Prevents any editing (drawing, erasing, selecting) of the layer's content.
- `folderId` (string | null): The ID of the `LayerFolder` this layer belongs to.

## 4. Layer Folders
Layer folders provide a way to group layers visually in the UI.
- They are one-level deep (no nested folders).
- Deleting a folder moves all its layers back to the root level.
- Moving a folder reorders all its constituent layers as a block.

## 5. Operations
- **Merge**: Combines multiple selected layers into a single layer. The resulting layer takes the position and properties of the top-most selected layer.
- **Normalization**: Older notebooks (without layers) are automatically migrated to a single-layer structure upon opening or syncing.
