<script setup lang="ts">
import { storeToRefs } from 'pinia';
import BatchResults from '../components/BatchResults.vue';
import { useConnectionStore } from '../useConnection';
definePage({ meta: { title: '运行结果', description: '选择手机，查看本次工作流在每台设备上的输出与截图。' } });
const connection = useConnectionStore();
const { deviceRunsRef, busyRef } = storeToRefs(connection);
</script>
<template><BatchResults :runs="deviceRunsRef" :busy="busyRef" @open-results="connection.openResults" /></template>
