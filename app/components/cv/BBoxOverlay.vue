<script setup lang="ts">
type Box = { x: number, y: number, w: number, h: number, label: string, confidence: number }
const props = defineProps<{ src: string, boxes: Box[] }>()

const canvasRef = ref<HTMLCanvasElement>()
const imgRef = ref<HTMLImageElement>()

function draw() {
  const c = canvasRef.value
  const i = imgRef.value
  if (!c || !i) return
  c.width = i.naturalWidth
  c.height = i.naturalHeight
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.drawImage(i, 0, 0)
  ctx.lineWidth = Math.max(2, c.width / 320)
  ctx.font = `${Math.max(12, c.width / 64)}px sans-serif`
  for (const b of props.boxes) {
    const x = b.x * c.width
    const y = b.y * c.height
    const w = b.w * c.width
    const h = b.h * c.height
    ctx.strokeStyle = severityColor(b.confidence)
    ctx.strokeRect(x, y, w, h)
    ctx.fillStyle = severityColor(b.confidence)
    ctx.fillText(`${b.label} ${(b.confidence * 100).toFixed(0)}%`, x, y - 4)
  }
}

function severityColor(c: number): string {
  if (c >= 0.8) return 'red'
  if (c >= 0.6) return 'orange'
  return 'yellow'
}

watch(() => props.src, () => {
  nextTick(draw)
})
watch(() => props.boxes, () => {
  nextTick(draw)
}, { deep: true })
</script>

<template>
  <div>
    <img
      ref="imgRef"
      :src="src"
      class="hidden"
      crossorigin="anonymous"
      @load="draw"
    >
    <canvas
      ref="canvasRef"
      class="max-w-full"
    />
  </div>
</template>
