
import os
import sys
from dotenv import load_dotenv

# Add backend directory to path so we can import services
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Load environment variables
load_dotenv()

from services.sagemaker_processor import SageMakerVideoProcessor

def check_sagemaker_status():
    print("Testing SageMakerVideoProcessor.check_endpoint_health()...")
    
    try:
        processor = SageMakerVideoProcessor()
        is_healthy, msg = processor.check_endpoint_health()
        
        if is_healthy:
            print(f"SUCCESS: {msg}")
        else:
            print(f"SUCCESS (Expected Failure): {msg}")
            print("This confirms that 'Process with AI' will be blocked with this specific error.")
            
    except Exception as e:
        print(f"Error during test: {e}")

if __name__ == "__main__":
    check_sagemaker_status()
