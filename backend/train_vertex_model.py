import os
import csv
import json
import logging
from google.cloud import storage
import vertexai
from vertexai.preview.tuning import sft

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "")
LOCATION = os.environ.get("VERTEX_AI_LOCATION", "us-central1")
BUCKET_NAME = os.environ.get("GCS_BUCKET", "")
# Comma-separated local directories of ASOKORE-style vulnerability CSVs. No
# default: this is user-specific local data, never hardcode a personal path.
DATA_DIRS = [d for d in os.environ.get("ASOKORE_DATA_DIRS", "").split(",") if d.strip()]
JSONL_OUTPUT = "asokore_tuning.jsonl"
GCS_DESTINATION = f"gs://{BUCKET_NAME}/datasets/{JSONL_OUTPUT}"

def extract_data():
    dataset = []
    
    for data_dir in DATA_DIRS:
        if not os.path.exists(data_dir):
            logging.warning(f"Directory not found: {data_dir}")
            continue
            
        for filename in os.listdir(data_dir):
            if not filename.endswith(".csv"):
                continue
                
            filepath = os.path.join(data_dir, filename)
            try:
                with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                    reader = csv.DictReader(f)
                    if not reader.fieldnames:
                        continue
                        
                    # Check if required columns exist
                    if 'vulnerability_description' not in reader.fieldnames or 'vulnerability_solution' not in reader.fieldnames:
                        continue
                        
                    for row in reader:
                        desc = row.get('vulnerability_description', '').strip()
                        sol = row.get('vulnerability_solution', '').strip()
                        name = row.get('vulnerability_name', '').strip()
                        
                        if desc and sol:
                            prompt = f"Vulnerability: {name}\n\nDescription: {desc}\n\nWhat is the recommended remediation or solution for this vulnerability?"
                            
                            example = {
                                "messages": [
                                    {
                                        "role": "system",
                                        "content": "You are a senior banking GRC security analyst. Your task is to provide explicit, highly accurate remediation plans for identified vulnerabilities based on standard security practices."
                                    },
                                    {
                                        "role": "user",
                                        "content": prompt
                                    },
                                    {
                                        "role": "model",
                                        "content": sol
                                    }
                                ]
                            }
                            dataset.append(example)
            except Exception as e:
                logging.error(f"Error reading {filename}: {e}")

    # Deduplicate based on prompt+solution to avoid identical rows
    unique_dataset = []
    seen = set()
    for ex in dataset:
        sig = ex["messages"][1]["content"] + ex["messages"][2]["content"]
        if sig not in seen:
            seen.add(sig)
            unique_dataset.append(ex)
            
    return unique_dataset

def main():
    if not DATA_DIRS:
        logging.error("ASOKORE_DATA_DIRS is not set. Export it as a comma-separated list of local directories.")
        return
    logging.info("1. Extracting data from ASOKORE CSVs...")
    dataset = extract_data()
    
    if len(dataset) < 10:
        logging.error(f"Only found {len(dataset)} examples. Fine-tuning requires at least 10 examples (recommend 100+). Aborting.")
        return
        
    logging.info(f"Found {len(dataset)} unique training examples.")
    
    logging.info(f"2. Writing to {JSONL_OUTPUT}...")
    with open(JSONL_OUTPUT, 'w', encoding='utf-8') as f:
        for ex in dataset:
            f.write(json.dumps(ex) + "\n")
            
    logging.info(f"3. Uploading to {GCS_DESTINATION}...")
    try:
        storage_client = storage.Client(project=PROJECT_ID)
        bucket = storage_client.bucket(BUCKET_NAME)
        blob = bucket.blob(f"datasets/{JSONL_OUTPUT}")
        blob.upload_from_filename(JSONL_OUTPUT)
        logging.info("Upload successful.")
    except Exception as e:
        logging.error(f"Failed to upload to GCS: {e}")
        return

    logging.info("4. Triggering Vertex AI Fine-Tuning Job...")
    try:
        vertexai.init(project=PROJECT_ID, location=LOCATION)
        sft_tuning_job = sft.train(
            source_model="gemini-1.5-flash-002",
            train_dataset=GCS_DESTINATION,
            epochs=4,
            learning_rate_multiplier=1.0,
            tuned_model_display_name="grc-auditor-v1"
        )
        
        logging.info("==================================================")
        logging.info(f"TRAINING JOB STARTED SUCCESSFULLY!")
        logging.info(f"Job Name: {sft_tuning_job.name}")
        logging.info(f"You can monitor the training progress in the Google Cloud Console:")
        logging.info(f"https://console.cloud.google.com/vertex-ai/studio/tuning?project={PROJECT_ID}")
        logging.info("==================================================")
        
    except Exception as e:
        logging.error(f"Failed to trigger Vertex AI tuning: {e}")

if __name__ == "__main__":
    main()
