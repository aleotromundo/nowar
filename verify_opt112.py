from pathlib import Path

root = Path(__file__).parent
queue = (root / 'modules/playback-queue.js').read_text(encoding='utf-8')
styles = (root / 'styles-secondary.css').read_text(encoding='utf-8')
sw = (root / 'sw.js').read_text(encoding='utf-8')

checks = {
    'virtualization_threshold_exists': 'const QUEUE_VIRTUAL_THRESHOLD = 100;' in queue,
    'virtual_render_exists': 'function renderVirtualQueue(list)' in queue,
    'virtual_render_is_conditional': 'if (queue.length >= QUEUE_VIRTUAL_THRESHOLD) renderVirtualQueue(list);' in queue,
    'overscan_exists': 'QUEUE_VIRTUAL_OVERSCAN' in queue,
    'stable_spacer_height': 'queue.length * QUEUE_VIRTUAL_STRIDE - QUEUE_VIRTUAL_GAP' in queue,
    'visible_rows_are_bounded': 'queue.slice(start, end)' in queue,
    'clicks_preserve_queue_index': 'playQueueAt(idx)' in queue,
    'remove_preserves_qid': 'removeFromQueue(song._qid)' in queue,
    'reorder_preserves_dragging': 'reorderQueue(dragSrcQid, song._qid, before)' in queue,
    'virtual_css_exists': '.queue-virtual-row { position: absolute' in styles,
    'service_worker_bumped': "CACHE_NAME = 'nowarfy-shell-v45'" in sw,
}
for key, value in checks.items():
    print(f'{key}: {value}')
assert all(checks.values()), checks
print('ALL_CHECKS_PASSED')
