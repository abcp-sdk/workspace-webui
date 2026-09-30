// Image / OCI cards: build an image, import an OCI image, and list the catalog.
import { arr, type CardCtx, type CardHandler, fin, fs, s } from './shared'

const repoBuildImage: CardHandler = ({ tool, data, input, output }) => {
  if (tool !== 'repo-build-image' && tool !== 'oci-import') {
    return null
  }
  const imageRef = s(data, 'image_ref')
  const tag = s(data, 'tag')
  const source = s(data, 'source')
  return {
    subtitle: 'image',
    input: {
      fields: fs(
        fin(input, 'org', 'building', 'org', { mono: true }),
        fin(input, 'image', 'box', 'image', { mono: true }),
        fin(input, 'name', 'box', 'tcName', { mono: true }),
        fin(input, 'tag', 'tag', 'tcTag', { mono: true }),
        fin(input, 'source', 'link', 'tcSource', { mono: true }),
        fin(input, 'dockerfile', 'file_code', 'tcDockerfile', { mono: true }),
        fin(input, 'context', 'folder', 'tcContext', { mono: true }),
        fin(input, 'tag-suffix', 'tag', 'tcSuffix', { mono: true }),
      ),
    },
    result: {
      fields: fs(
        imageRef
          ? { icon: 'box', label: 'image', value: imageRef, mono: true }
          : null,
        tag
          ? {
              icon: 'tag',
              label: 'tcTag',
              value: tag,
              mono: true,
              tone: 'muted',
            }
          : null,
        source
          ? {
              icon: 'link',
              label: 'tcSource',
              value: source,
              mono: true,
              tone: 'muted',
            }
          : null,
      ),
      // The build / import LOG (the output carries a header line + the log).
      body: output ? { kind: 'terminal', text: output } : undefined,
    },
  }
}

const listOciImages: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'list-oci-images') return null
  const images = arr<{
    owner: string
    name: string
    tag: string
    ref?: string
  }>(data, 'images')
  return {
    subtitle: 'tcOci',
    input: {
      fields: fs(
        fin(input, 'owner', 'building', 'tcOwner', { mono: true }),
        fin(input, 'name', 'box', 'tcName', { mono: true }),
      ),
    },
    result: {
      fields: [
        { icon: 'box', label: 'tcImages', value: String(images.length) },
      ],
      body: images.length ? { kind: 'images', images } : undefined,
    },
  }
}

/** Image / OCI handlers, in match order. */
export const imageHandlers: CardHandler[] = [repoBuildImage, listOciImages]

export type { CardCtx }
