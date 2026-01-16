"""Test chatbot with ambiguous frame question"""
import sys
sys.path.insert(0, '/Volumes/WD_2TB/Projects/dev_lenovo/RoadVisionAI/roadrunner-survey-ai-neelansh-demo/backend')

from ai.chatbot_ai import get_chatbot

chatbot = get_chatbot()

questions = [
    "How many road markings are there on frame 201?",
    "How many road markings are on frame 201 of route 105?",
]

print("=" * 80)
print("TESTING AMBIGUOUS FRAME QUERIES")
print("=" * 80)

for i, question in enumerate(questions, 1):
    print(f"\n{i}. Question: {question}")
    print("-" * 80)
    answer = chatbot.ask(question)
    print(f"Answer: {answer}")
    print()

print("=" * 80)
print("EXPECTED ANSWERS:")
print("1. Should mention ambiguity (26 frames) OR count all (77)")
print("2. Should say 4 road markings (specific to route 105)")
print("=" * 80)
