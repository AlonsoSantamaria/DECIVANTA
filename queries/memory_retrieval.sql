SELECT id, source_type, source_id, embedding <=> $2::VECTOR AS cosine_distance
FROM memory_items
WHERE organization_id = $1::UUID AND embedding IS NOT NULL
ORDER BY embedding <=> $2::VECTOR
LIMIT 5;
