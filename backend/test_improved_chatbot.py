"""Test the improved chatbot with the same question"""
import sys
sys.path.insert(0, '/Volumes/WD_2TB/Projects/dev_lenovo/RoadVisionAI/roadrunner-survey-ai-neelansh-demo/backend')

from ai.chatbot_ai import get_chatbot

# Initialize chatbot
chatbot = get_chatbot()

# Test questions
questions = [
    "How many street lights are on route 105?",
    "How many frames have street lights on route 105?",
    "Count all road markings in the database",
]

print("=" * 80)
print("TESTING IMPROVED CHATBOT")
print("=" * 80)

for i, question in enumerate(questions, 1):
    print(f"\n{i}. Question: {question}")
    print("-" * 80)
    answer = chatbot.ask(question)
    print(f"Answer: {answer}")
    print()

print("=" * 80)
print("VERIFICATION:")
print("Expected: ~33,931 street lights on route 105")
print("=" * 80)
