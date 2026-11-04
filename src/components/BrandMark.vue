<script setup>
defineProps({
  size: { type: Number, default: 40 }
})
</script>

<template>
  <!-- 两枚小圆点代表两个人，放在一只安静的盘子里 -->
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 100 100"
    role="img"
    aria-label="两人食"
    class="shrink-0"
  >
    <circle cx="50" cy="50" r="48" fill="#E7ECE2" stroke="#D2DCC9" stroke-width="1.4" />
    <circle cx="50" cy="50" r="33" fill="#FFFDFA" stroke="#EFE9E0" stroke-width="1.2" />
    <circle cx="38" cy="52" r="7.6" fill="#D9AE99" />
    <circle cx="62" cy="52" r="7.6" fill="#B6C4AA" />
  </svg>
</template>
