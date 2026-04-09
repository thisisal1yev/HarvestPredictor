import { S3Client, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let _s3: S3Client | null = null

function s3(): S3Client {
  if (_s3) return _s3
  const cfg = useRuntimeConfig()
  _s3 = new S3Client({
    endpoint: cfg.minioPublicEndpoint as string, // e.g. "https://app.example.com"
    region: 'us-east-1', // ignored by MinIO; SDK requires non-empty
    credentials: {
      accessKeyId: cfg.minioAccessKey as string,
      secretAccessKey: cfg.minioSecretKey as string
    },
    forcePathStyle: true
  })
  return _s3
}

export async function presignGet(key: string, ttlSeconds?: number): Promise<string> {
  const cfg = useRuntimeConfig()
  const cmd = new GetObjectCommand({ Bucket: cfg.minioBucket as string, Key: key })
  return getSignedUrl(s3(), cmd, {
    expiresIn: ttlSeconds ?? (Number(cfg.minioPresignedTtl) || 3600)
  })
}

export async function deleteSnapshotPrefix(snapshotKey: string): Promise<void> {
  // snapshotKey = "detections/2026/04/08/01J..."
  // Objects under it: full.jpg, thumb.jpg
  const cfg = useRuntimeConfig()
  await s3().send(new DeleteObjectsCommand({
    Bucket: cfg.minioBucket as string,
    Delete: {
      Objects: [
        { Key: `${snapshotKey}/full.jpg` },
        { Key: `${snapshotKey}/thumb.jpg` }
      ]
    }
  }))
}
